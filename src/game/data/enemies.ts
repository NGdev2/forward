import type { EnemyBase, EnemyInstance, IntentKind } from '../types';
import type { StatusApplication } from './abilities';
import { name as cname, t } from '../../i18n';

/* ============================================================================
 * Enemy behaviour — archetypes and move sets.
 *
 * Every enemy has an archetype that decides how it fights: what it telegraphs,
 * how it opens, and what it does when it's hurt. The engine reads these tables
 * by enemy id, so no shared type has to change.
 * ========================================================================== */

export type Archetype =
  | 'brute'
  | 'skirmisher'
  | 'caster'
  | 'warden'
  | 'venom'
  | 'leech'
  | 'phantom'
  | 'swarm';

/** One thing an enemy can do on its turn — also what the player sees coming. */
export interface EnemyMove {
  id: string;
  kind: IntentKind;
  label: string;
  icon: string;
  /** Damage multiplier on the enemy's atk. 0 for non-damaging moves. */
  power: number;
  hits?: number;
  /** Selection weight within the current move pool. */
  weight: number;
  /** Fraction of the player's defense ignored, 0..1. */
  pierce?: number;
  applies?: StatusApplication;
  applies2?: StatusApplication;
  /** Heals the enemy for this fraction of its max HP. */
  healPct?: number;
  /** Grants the enemy shield equal to atk x this. */
  shieldFromAtk?: number;
  /** Steals this fraction of damage dealt as healing. */
  drain?: number;
  /** Wind-up: this turn does nothing, next turn unleashes `payoff`. */
  payoff?: Omit<EnemyMove, 'weight' | 'payoff' | 'id'> & { id?: string };
  /** Only selectable while the enemy is above this HP fraction. */
  aboveHp?: number;
  /** Only selectable while the enemy is below this HP fraction. */
  belowHp?: number;
  /** Turns before it can be selected again. */
  cooldown?: number;
  /** Never selected on the very first turn. */
  notOpener?: boolean;
}

const mv = (m: EnemyMove): EnemyMove => m;

/* ------------------------------------------------------- archetype moveset -- */

export const ARCHETYPE_MOVES: Record<Archetype, EnemyMove[]> = {
  brute: [
    mv({ id: 'm_swing', kind: 'attack', label: 'Swing', icon: '⚔️', power: 1, weight: 100 }),
    mv({
      id: 'm_slam',
      kind: 'heavy',
      label: 'Crushing Slam',
      icon: '💢',
      power: 1.85,
      weight: 55,
      cooldown: 2
    }),
    mv({
      id: 'm_roar',
      kind: 'buff',
      label: 'Bellow',
      icon: '😤',
      power: 0,
      weight: 34,
      cooldown: 4,
      notOpener: true,
      applies: { status: 'enrage', stacks: 2, turns: 3, chance: 1, onSelf: true }
    }),
    mv({
      id: 'm_windup',
      kind: 'special',
      label: 'Winding Up…',
      icon: '🌀',
      power: 0,
      weight: 26,
      cooldown: 4,
      belowHp: 0.6,
      payoff: { kind: 'heavy', label: 'Skullbreaker', icon: '☄️', power: 2.8, pierce: 0.4 }
    })
  ],
  skirmisher: [
    mv({ id: 'm_jab', kind: 'attack', label: 'Quick Jab', icon: '⚔️', power: 0.9, weight: 100 }),
    mv({
      id: 'm_rake',
      kind: 'attack',
      label: 'Rake',
      icon: '🩸',
      power: 0.75,
      hits: 2,
      weight: 60,
      cooldown: 1,
      applies: { status: 'bleed', stacks: 2, turns: 3, chance: 0.8 }
    }),
    mv({
      id: 'm_lunge',
      kind: 'heavy',
      label: 'Throat Lunge',
      icon: '💢',
      power: 1.6,
      weight: 40,
      pierce: 0.5,
      cooldown: 2
    }),
    mv({
      id: 'm_dodge',
      kind: 'defend',
      label: 'Circle Away',
      icon: '🌀',
      power: 0,
      weight: 22,
      cooldown: 3,
      shieldFromAtk: 1.4,
      notOpener: true
    })
  ],
  caster: [
    mv({ id: 'm_bolt', kind: 'attack', label: 'Dark Bolt', icon: '🔮', power: 1.05, weight: 100, pierce: 0.5 }),
    mv({
      id: 'm_hex',
      kind: 'debuff',
      label: 'Hex',
      icon: '🔻',
      power: 0.35,
      weight: 55,
      cooldown: 3,
      applies: { status: 'weaken', stacks: 2, turns: 3, chance: 1 }
    }),
    mv({
      id: 'm_channel',
      kind: 'special',
      label: 'Channelling…',
      icon: '✨',
      power: 0,
      weight: 45,
      cooldown: 3,
      payoff: { kind: 'special', label: 'Ruinous Blast', icon: '💠', power: 2.6, pierce: 0.8 }
    }),
    mv({
      id: 'm_wardc',
      kind: 'defend',
      label: 'Mana Ward',
      icon: '🛡️',
      power: 0,
      weight: 25,
      cooldown: 3,
      belowHp: 0.5,
      shieldFromAtk: 2
    })
  ],
  warden: [
    mv({ id: 'm_bash', kind: 'attack', label: 'Shield Bash', icon: '⚔️', power: 0.95, weight: 100 }),
    mv({
      id: 'm_brace',
      kind: 'defend',
      label: 'Brace',
      icon: '🛡️',
      power: 0,
      weight: 55,
      cooldown: 2,
      shieldFromAtk: 2.4,
      applies: { status: 'fortify', stacks: 2, turns: 2, chance: 1, onSelf: true }
    }),
    mv({
      id: 'm_pin',
      kind: 'heavy',
      label: 'Pinning Blow',
      icon: '💢',
      power: 1.5,
      weight: 45,
      cooldown: 2,
      applies: { status: 'stun', stacks: 1, turns: 1, chance: 0.3 }
    }),
    mv({
      id: 'm_mend',
      kind: 'heal',
      label: 'Stone Mend',
      icon: '💚',
      power: 0,
      weight: 30,
      cooldown: 4,
      belowHp: 0.45,
      healPct: 0.16
    })
  ],
  venom: [
    mv({ id: 'm_bite', kind: 'attack', label: 'Bite', icon: '⚔️', power: 0.85, weight: 100 }),
    mv({
      id: 'm_spit',
      kind: 'debuff',
      label: 'Venom Spit',
      icon: '☠️',
      power: 0.5,
      weight: 70,
      cooldown: 1,
      applies: { status: 'poison', stacks: 3, turns: 4, chance: 1 }
    }),
    mv({
      id: 'm_fangs',
      kind: 'heavy',
      label: 'Deep Fangs',
      icon: '💢',
      power: 1.55,
      weight: 40,
      cooldown: 2,
      applies: { status: 'poison', stacks: 2, turns: 3, chance: 0.7 }
    }),
    mv({
      id: 'm_molt',
      kind: 'buff',
      label: 'Molt',
      icon: '🌀',
      power: 0,
      weight: 22,
      cooldown: 4,
      belowHp: 0.5,
      healPct: 0.1,
      shieldFromAtk: 1.2
    })
  ],
  leech: [
    mv({ id: 'm_claw', kind: 'attack', label: 'Claw', icon: '⚔️', power: 0.95, weight: 100 }),
    mv({
      id: 'm_siphon',
      kind: 'special',
      label: 'Siphon Life',
      icon: '🧛',
      power: 1.2,
      weight: 70,
      cooldown: 1,
      drain: 0.8
    }),
    mv({
      id: 'm_gorge',
      kind: 'heavy',
      label: 'Gorge',
      icon: '💢',
      power: 1.7,
      weight: 40,
      cooldown: 3,
      drain: 0.5,
      belowHp: 0.7
    }),
    mv({
      id: 'm_feast',
      kind: 'heal',
      label: 'Feast',
      icon: '💚',
      power: 0,
      weight: 26,
      cooldown: 4,
      belowHp: 0.4,
      healPct: 0.18
    })
  ],
  phantom: [
    mv({ id: 'm_touch', kind: 'attack', label: 'Chill Touch', icon: '⚔️', power: 0.9, weight: 100, pierce: 0.6 }),
    mv({
      id: 'm_wail',
      kind: 'debuff',
      label: 'Wail',
      icon: '💫',
      power: 0.4,
      weight: 55,
      cooldown: 3,
      applies: { status: 'stun', stacks: 1, turns: 1, chance: 0.45 }
    }),
    mv({
      id: 'm_fade',
      kind: 'defend',
      label: 'Fade',
      icon: '🌫️',
      power: 0,
      weight: 35,
      cooldown: 3,
      notOpener: true,
      shieldFromAtk: 1.8
    }),
    mv({
      id: 'm_reap',
      kind: 'heavy',
      label: 'Soul Reap',
      icon: '💢',
      power: 1.75,
      weight: 45,
      cooldown: 2,
      pierce: 0.7,
      belowHp: 0.6
    })
  ],
  swarm: [
    mv({ id: 'm_nip', kind: 'attack', label: 'Nip', icon: '⚔️', power: 0.55, hits: 2, weight: 100 }),
    mv({
      id: 'm_scurry',
      kind: 'attack',
      label: 'Scurry Strike',
      icon: '🌀',
      power: 0.45,
      hits: 3,
      weight: 60,
      cooldown: 1,
      applies: { status: 'bleed', stacks: 1, turns: 2, chance: 0.5 }
    }),
    mv({
      id: 'm_frenzy',
      kind: 'buff',
      label: 'Frenzy',
      icon: '😤',
      power: 0,
      weight: 34,
      cooldown: 4,
      belowHp: 0.55,
      applies: { status: 'enrage', stacks: 3, turns: 3, chance: 1, onSelf: true }
    }),
    mv({
      id: 'm_pile',
      kind: 'heavy',
      label: 'Pile On',
      icon: '💢',
      power: 1.5,
      weight: 40,
      cooldown: 2
    })
  ]
};

/** Per-archetype stat tuning applied on top of the base numbers. */
export const ARCHETYPE_TRAITS: Record<Archetype, { hp: number; atk: number; def: number; tag: string }> = {
  brute: { hp: 1.1, atk: 1.05, def: 0.9, tag: 'Brute' },
  skirmisher: { hp: 0.85, atk: 1.12, def: 0.95, tag: 'Skirmisher' },
  caster: { hp: 0.82, atk: 1.15, def: 0.8, tag: 'Caster' },
  warden: { hp: 1.25, atk: 0.85, def: 1.5, tag: 'Warden' },
  venom: { hp: 0.95, atk: 0.9, def: 1.0, tag: 'Venomous' },
  leech: { hp: 1.0, atk: 1.0, def: 1.0, tag: 'Leech' },
  phantom: { hp: 0.88, atk: 1.05, def: 0.85, tag: 'Phantom' },
  swarm: { hp: 0.9, atk: 0.95, def: 0.9, tag: 'Swarm' }
};

export const ENEMY_ARCHETYPE: Record<string, Archetype> = {
  e_rat: 'swarm',
  e_slime: 'warden',
  e_bat: 'skirmisher',
  e_crow: 'skirmisher',
  e_goblin: 'skirmisher',
  e_spider: 'venom',
  e_boar: 'brute',
  e_bandit: 'skirmisher',
  e_skeleton: 'warden',
  e_wolf: 'swarm',
  e_orc: 'brute',
  e_ghoul: 'leech',
  e_wraith: 'phantom',
  e_troll: 'brute',
  e_harpy: 'skirmisher',
  e_minotaur: 'brute',
  e_golem: 'warden',
  e_wyvern: 'venom',
  e_banshee: 'phantom',
  e_lich: 'caster',
  e_hydra: 'venom',
  e_chimera: 'brute',
  e_direbear: 'brute',
  e_gargoyle: 'warden',
  e_revenant: 'phantom',
  e_wyrm: 'caster',
  e_behemoth: 'warden',
  e_specterlord: 'phantom',
  e_frostgiant: 'brute',
  e_direphoenix: 'caster',
  e_krakenling: 'venom',
  e_voidspawn: 'leech',
  e_starwyrm: 'caster',
  e_deathless: 'warden'
};

export function archetypeFor(enemyId: string): Archetype {
  return ENEMY_ARCHETYPE[enemyId] ?? 'brute';
}


export const ENEMY_BASES: EnemyBase[] = [
  // Tier 1
  { id: 'e_rat', name: 'Sewer Rat', icon: '🐀', tier: 1, minLevel: 1, hpBase: 14, atkBase: 2, goldBase: 4, xpBase: 6 },
  { id: 'e_slime', name: 'Slime', icon: '🟢', tier: 1, minLevel: 1, hpBase: 18, atkBase: 2, goldBase: 5, xpBase: 7 },
  { id: 'e_bat', name: 'Cave Bat', icon: '🦇', tier: 1, minLevel: 1, hpBase: 12, atkBase: 3, goldBase: 4, xpBase: 6 },
  { id: 'e_crow', name: 'Carrion Crow', icon: '🐦‍⬛', tier: 1, minLevel: 2, hpBase: 16, atkBase: 3, goldBase: 5, xpBase: 7 },

  // Tier 2
  { id: 'e_goblin', name: 'Goblin Skulker', icon: '👺', tier: 2, minLevel: 5, hpBase: 26, atkBase: 4, goldBase: 8, xpBase: 12 },
  { id: 'e_spider', name: 'Cave Spider', icon: '🕷️', tier: 2, minLevel: 5, hpBase: 24, atkBase: 5, goldBase: 8, xpBase: 12 },
  { id: 'e_boar', name: 'Wild Boar', icon: '🐗', tier: 2, minLevel: 5, hpBase: 30, atkBase: 5, goldBase: 9, xpBase: 13 },
  { id: 'e_bandit', name: 'Roadside Bandit', icon: '🗡️', tier: 2, minLevel: 6, hpBase: 28, atkBase: 5, goldBase: 10, xpBase: 13 },

  // Tier 3
  { id: 'e_skeleton', name: 'Skeleton', icon: '💀', tier: 3, minLevel: 9, hpBase: 40, atkBase: 7, goldBase: 14, xpBase: 20 },
  { id: 'e_wolf', name: 'Dire Wolf', icon: '🐺', tier: 3, minLevel: 9, hpBase: 44, atkBase: 8, goldBase: 15, xpBase: 21 },
  { id: 'e_orc', name: 'Orc Brute', icon: '👹', tier: 3, minLevel: 9, hpBase: 50, atkBase: 8, goldBase: 16, xpBase: 22 },
  { id: 'e_ghoul', name: 'Graveyard Ghoul', icon: '🧟', tier: 3, minLevel: 10, hpBase: 46, atkBase: 8, goldBase: 16, xpBase: 22 },

  // Tier 4
  { id: 'e_wraith', name: 'Wraith', icon: '👻', tier: 4, minLevel: 13, hpBase: 60, atkBase: 10, goldBase: 22, xpBase: 30 },
  { id: 'e_troll', name: 'Bridge Troll', icon: '🧌', tier: 4, minLevel: 13, hpBase: 70, atkBase: 11, goldBase: 24, xpBase: 32 },
  { id: 'e_harpy', name: 'Harpy', icon: '🦅', tier: 4, minLevel: 13, hpBase: 58, atkBase: 12, goldBase: 23, xpBase: 31 },
  { id: 'e_minotaur', name: 'Labyrinth Minotaur', icon: '🐂', tier: 4, minLevel: 14, hpBase: 66, atkBase: 12, goldBase: 25, xpBase: 33 },

  // Tier 5
  { id: 'e_golem', name: 'Stone Golem', icon: '🗿', tier: 5, minLevel: 17, hpBase: 95, atkBase: 13, goldBase: 34, xpBase: 45 },
  { id: 'e_wyvern', name: 'Wyvern', icon: '🐲', tier: 5, minLevel: 17, hpBase: 90, atkBase: 15, goldBase: 36, xpBase: 47 },
  { id: 'e_banshee', name: 'Banshee', icon: '🎭', tier: 5, minLevel: 18, hpBase: 92, atkBase: 15, goldBase: 37, xpBase: 47 },

  // Tier 6
  { id: 'e_lich', name: 'Lich Acolyte', icon: '🧙', tier: 6, minLevel: 21, hpBase: 120, atkBase: 17, goldBase: 48, xpBase: 60 },
  { id: 'e_hydra', name: 'Young Hydra', icon: '🐍', tier: 6, minLevel: 21, hpBase: 130, atkBase: 18, goldBase: 52, xpBase: 64 },
  { id: 'e_chimera', name: 'Chimera', icon: '🦁', tier: 6, minLevel: 22, hpBase: 126, atkBase: 19, goldBase: 51, xpBase: 63 },

  // Tier 7
  { id: 'e_direbear', name: 'Ashfang Bear', icon: '🐻', tier: 7, minLevel: 25, hpBase: 172, atkBase: 22, goldBase: 66, xpBase: 82 },
  { id: 'e_gargoyle', name: 'Stormstone Gargoyle', icon: '🗿', tier: 7, minLevel: 25, hpBase: 165, atkBase: 23, goldBase: 64, xpBase: 80 },
  { id: 'e_revenant', name: 'Hollow Revenant', icon: '🥷', tier: 7, minLevel: 26, hpBase: 178, atkBase: 24, goldBase: 68, xpBase: 84 },

  // Tier 8
  { id: 'e_wyrm', name: 'Ironscale Wyrm', icon: '🐉', tier: 8, minLevel: 29, hpBase: 225, atkBase: 27, goldBase: 84, xpBase: 102 },
  { id: 'e_behemoth', name: 'Sandstone Behemoth', icon: '🐘', tier: 8, minLevel: 29, hpBase: 240, atkBase: 28, goldBase: 88, xpBase: 106 },
  { id: 'e_specterlord', name: 'Specter Lord', icon: '👤', tier: 8, minLevel: 30, hpBase: 232, atkBase: 29, goldBase: 90, xpBase: 108 },

  // Tier 9
  { id: 'e_frostgiant', name: 'Frost Giant', icon: '🧊', tier: 9, minLevel: 33, hpBase: 285, atkBase: 33, goldBase: 105, xpBase: 128 },
  { id: 'e_direphoenix', name: 'Ashen Phoenix', icon: '🔥', tier: 9, minLevel: 33, hpBase: 275, atkBase: 34, goldBase: 108, xpBase: 132 },
  { id: 'e_krakenling', name: 'Krakenling', icon: '🦑', tier: 9, minLevel: 34, hpBase: 295, atkBase: 35, goldBase: 110, xpBase: 134 },

  // Tier 10
  { id: 'e_voidspawn', name: 'Voidspawn Horror', icon: '🌌', tier: 10, minLevel: 37, hpBase: 360, atkBase: 40, goldBase: 128, xpBase: 158 },
  { id: 'e_starwyrm', name: 'Starwyrm', icon: '🐍', tier: 10, minLevel: 38, hpBase: 372, atkBase: 41, goldBase: 132, xpBase: 162 },
  { id: 'e_deathless', name: 'Deathless Colossus', icon: '⚰️', tier: 10, minLevel: 40, hpBase: 395, atkBase: 43, goldBase: 140, xpBase: 170 }
];

function tierForLevel(level: number): number {
  return Math.max(1, Math.min(10, Math.ceil(level / 4)));
}

/* ------------------------------------------------------------------ curve -- */

/**
 * Level curve. Enemy stats are computed from the player level directly (the
 * base tables only provide per-creature flavour around the tier average), so
 * the whole difficulty curve lives in these numbers. Tuned with `npm run sim`;
 * the resulting table is in scripts/BALANCE.md.
 */
export const ENEMY_TUNING = {
  /** Nominal HP of an on-level normal enemy: hp0 + hp1·L + hp2·L². */
  hp0: 21,
  hp1: 22,
  hp2: 0.55,
  /** Nominal attack of an on-level normal enemy. */
  atk0: 5,
  atk1: 2.0,
  atk2: 0.12,
  /** Nominal defense. */
  def0: 2,
  def1: 3,
  /** Rewards. */
  xp0: 6,
  xp1: 2.4,
  xp2: 0.06,
  gold0: 5,
  gold1: 2.5,
  gold2: 0.04,
  /**
   * Elite multipliers (on top of the +1 level the road gives them). They grow
   * with level: a fresh hero has no potions or sustain to absorb a double-strength
   * hit, a level-30 hero has plenty.
   */
  eliteHp: 0.65,
  eliteHpPerLevel: 0.005,
  eliteAtk: 1.5,
  eliteAtkPerLevel: 0.01,
  eliteDef: 1.2,
  eliteGold: 2.5,
  eliteXp: 2.2,
  /** How far a creature's own base numbers may pull it from the tier average. */
  flavourSpread: 0.6
};

export function nominalHp(level: number): number {
  const T = ENEMY_TUNING;
  return T.hp0 + T.hp1 * level + T.hp2 * level * level;
}
export function nominalAtk(level: number): number {
  const T = ENEMY_TUNING;
  return T.atk0 + T.atk1 * level + T.atk2 * level * level;
}
export function nominalDef(level: number): number {
  const T = ENEMY_TUNING;
  return T.def0 + T.def1 * level;
}
export function nominalXp(level: number): number {
  const T = ENEMY_TUNING;
  return T.xp0 + T.xp1 * level + T.xp2 * level * level;
}
export function nominalGold(level: number): number {
  const T = ENEMY_TUNING;
  return T.gold0 + T.gold1 * level + T.gold2 * level * level;
}

/** Tier averages of the base table, so a creature's numbers become a relative flavour factor. */
const TIER_MEAN: Record<number, { hp: number; atk: number; gold: number; xp: number; n: number }> = {};
for (const e of ENEMY_BASES) {
  const t = (TIER_MEAN[e.tier] ??= { hp: 0, atk: 0, gold: 0, xp: 0, n: 0 });
  t.hp += e.hpBase;
  t.atk += e.atkBase;
  t.gold += e.goldBase;
  t.xp += e.xpBase;
  t.n += 1;
}
for (const t of Object.values(TIER_MEAN)) {
  t.hp /= t.n;
  t.atk /= t.n;
  t.gold /= t.n;
  t.xp /= t.n;
}

/** base / tier mean, pulled toward 1 so flavour never dominates the curve. */
function flavour(value: number, mean: number): number {
  const ratio = mean > 0 ? value / mean : 1;
  return 1 + (ratio - 1) * ENEMY_TUNING.flavourSpread;
}

const ELITE_ABILITIES: EnemyInstance['ability'][] = ['lifesteal', 'reflect', 'enrage'];

const ELITE_PREFIX = ['Elite', 'Savage', 'Ancient', 'Dread', 'Warscarred'];

function scaledEnemy(base: EnemyBase, level: number, elite: boolean): EnemyInstance {
  const T = ENEMY_TUNING;
  const arch = archetypeFor(base.id);
  const traits = ARCHETYPE_TRAITS[arch];
  const mean = TIER_MEAN[base.tier] ?? { hp: base.hpBase, atk: base.atkBase, gold: base.goldBase, xp: base.xpBase, n: 1 };
  const eliteHp = T.eliteHp + T.eliteHpPerLevel * level;
  const eliteAtk = T.eliteAtk + T.eliteAtkPerLevel * level;
  const hp = Math.max(1, Math.round(nominalHp(level) * flavour(base.hpBase, mean.hp) * traits.hp * (elite ? eliteHp : 1)));
  const atk = Math.max(1, Math.round(nominalAtk(level) * flavour(base.atkBase, mean.atk) * traits.atk * (elite ? eliteAtk : 1)));
  const def = Math.max(0, Math.round(nominalDef(level) * traits.def * (elite ? T.eliteDef : 1)));
  const gold = Math.round(nominalGold(level) * flavour(base.goldBase, mean.gold) * (elite ? T.eliteGold : 1));
  const xp = Math.round(nominalXp(level) * flavour(base.xpBase, mean.xp) * (elite ? T.eliteXp : 1));
  const prefix = elite ? ELITE_PREFIX[Math.floor(Math.random() * ELITE_PREFIX.length)] : '';
  return {
    id: base.id,
    name: elite
      ? t('data.elite_name', { prefix: cname('elite', prefix, prefix), name: cname('enemy', base.id, base.name) })
      : cname('enemy', base.id, base.name),
    icon: base.icon,
    hp,
    maxHp: hp,
    atk,
    def,
    goldReward: gold,
    xpReward: xp,
    isBoss: false,
    isElite: elite,
    guaranteedRarity: elite ? 'rare' : undefined,
    title: elite ? t('data.elite_title', { tag: cname('archetype', arch, traits.tag) }) : cname('archetype', arch, traits.tag),
    ability: elite ? ELITE_ABILITIES[Math.floor(Math.random() * ELITE_ABILITIES.length)] : undefined,
    statuses: [],
    shield: 0
  };
}

export function pickEnemy(level: number, elite = false): EnemyInstance {
  const targetTier = tierForLevel(level);
  const candidates = ENEMY_BASES.filter(e => e.tier <= targetTier && e.minLevel <= level + 2);
  const pool = candidates.length > 0 ? candidates : [ENEMY_BASES[0]];
  const weighted = pool.filter(e => e.tier >= targetTier - 1);
  const finalPool = weighted.length > 0 ? weighted : pool;
  const base = finalPool[Math.floor(Math.random() * finalPool.length)];
  return scaledEnemy(base, level, elite);
}

import type { BossBase, EnemyInstance } from '../types';
import type { StatusApplication } from './abilities';
import { field as cfield, name as cname, t } from '../../i18n';
import { nominalAtk, nominalDef, nominalGold, nominalHp, nominalXp, type Archetype, type EnemyMove } from './enemies';

/**
 * Boss roster. `hpMult`/`atkMult` are RELATIVE to the level-nominal boss
 * (see pickBoss): 1.0 is a standard boss, tanks trade attack for HP, glass
 * casters the reverse. Later bosses creep upward because they are also the
 * higher-rank loop. `goldMult`/`xpMult` are relative to the nominal boss reward.
 * `ability` is flavour on bosses (their scripts carry the mechanics); the
 * engine only applies elite abilities to elites.
 */
export const BOSS_BASES: BossBase[] = [
  { id: 'b_ratking', name: 'Ratking', title: 'Lord of the Sewers', icon: '👑🐀', hpMult: 0.9, atkMult: 0.9, goldMult: 1, xpMult: 1, guaranteedRarity: 'uncommon', flavor: 'A pile of rats wearing a crown of bones.' },
  { id: 'b_goblinchief', name: 'Grubnash', title: 'the Goblin Chief', icon: '👺', hpMult: 1, atkMult: 1.4, goldMult: 1.05, xpMult: 1.05, guaranteedRarity: 'rare', flavor: 'Commands every goblin in the warrens.' },
  { id: 'b_directwolf', name: 'Fenrik', title: 'the Direwolf', icon: '🐺', hpMult: 1.1, atkMult: 1.1, goldMult: 1.1, xpMult: 1.1, guaranteedRarity: 'rare', flavor: 'Runs faster than the road itself.' },
  { id: 'b_orcwarlord', name: 'Grommash', title: 'the Warlord', icon: '👹', hpMult: 1.15, atkMult: 1.25, goldMult: 1.15, xpMult: 1.15, guaranteedRarity: 'epic', flavor: 'Broke a hundred shields with his bare fists.' },
  { id: 'b_wraithqueen', name: 'Morwen', title: 'the Wraith Queen', icon: '👻', hpMult: 1.15, atkMult: 1.35, goldMult: 1.2, xpMult: 1.2, guaranteedRarity: 'epic', flavor: 'Feeds on the light of the road ahead.' },
  { id: 'b_stonetitan', name: 'Gravemaw', title: 'the Stone Titan', icon: '🗿', hpMult: 1.05, atkMult: 1.05, goldMult: 1.25, xpMult: 1.25, guaranteedRarity: 'epic', flavor: 'Every step it takes cracks the ground.' },
  { id: 'b_wyvernlord', name: 'Skarrix', title: 'the Wyvern Lord', icon: '🐲', hpMult: 1.15, atkMult: 1.05, goldMult: 1.3, xpMult: 1.3, guaranteedRarity: 'legendary', flavor: 'Circles above before it dives.' },
  { id: 'b_lich', name: 'Azharok', title: 'the Undying', icon: '🧙‍♂️', hpMult: 0.95, atkMult: 1.3, goldMult: 1.35, xpMult: 1.35, guaranteedRarity: 'legendary', flavor: 'Has died before. Remembers it.', ability: 'lifesteal' },
  { id: 'b_hydra', name: 'Vaskarra', title: 'the Nine-Headed', icon: '🐍', hpMult: 1.05, atkMult: 0.95, goldMult: 1.4, xpMult: 1.4, guaranteedRarity: 'legendary', flavor: 'Cut one head and two more count the loss.', ability: 'enrage' },
  { id: 'b_voidherald', name: 'Nyxareth', title: 'Herald of the Void', icon: '🌌', hpMult: 1.3, atkMult: 1.25, goldMult: 1.5, xpMult: 1.5, guaranteedRarity: 'mythic', flavor: 'The road ends where it stands, then continues anyway.', ability: 'reflect' },
  { id: 'b_thornqueen', name: 'Ysolde', title: 'the Thornqueen', icon: '🥀', hpMult: 1.1, atkMult: 0.95, goldMult: 1.5, xpMult: 1.5, guaranteedRarity: 'legendary', flavor: 'Her garden grows only in salted soil.', ability: 'reflect' },
  { id: 'b_juggernaut', name: 'Juggernaut Prime', title: 'the Iron Vanguard', icon: '🤖', hpMult: 1.25, atkMult: 1.25, goldMult: 1.55, xpMult: 1.55, guaranteedRarity: 'legendary', flavor: 'Built to end wars, kept around to start them.', ability: 'enrage' },
  { id: 'b_stormcaller', name: 'Kaelen', title: 'the Stormcaller', icon: '⛈️', hpMult: 0.9, atkMult: 1.05, goldMult: 1.6, xpMult: 1.6, guaranteedRarity: 'legendary', flavor: 'Thunder answers before he even speaks.' },
  { id: 'b_abysslord', name: 'Mordreth', title: 'the Abysslord', icon: '🕳️', hpMult: 1.1, atkMult: 1.1, goldMult: 1.65, xpMult: 1.65, guaranteedRarity: 'mythic', flavor: 'Something down there finally noticed the road.', ability: 'lifesteal' },
  { id: 'b_frostmonarch', name: 'Sythera', title: 'the Frost Monarch', icon: '🥶', hpMult: 1.25, atkMult: 1.2, goldMult: 1.7, xpMult: 1.7, guaranteedRarity: 'mythic', flavor: 'Her throne is the last warm place for a hundred miles.' },
  { id: 'b_bloodreaver', name: 'Karn', title: 'the Bloodreaver', icon: '🩸', hpMult: 1.05, atkMult: 0.95, goldMult: 1.75, xpMult: 1.75, guaranteedRarity: 'mythic', flavor: 'Counts his kills by the color of his blade.', ability: 'lifesteal' },
  { id: 'b_starweaver', name: 'Alune', title: 'the Starweaver', icon: '🌠', hpMult: 1.2, atkMult: 1.4, goldMult: 1.8, xpMult: 1.8, guaranteedRarity: 'mythic', flavor: 'Stitches fate from threads no one else can see.', ability: 'reflect' },
  { id: 'b_worldeater', name: 'Chthon', title: 'the World Eater', icon: '🌋', hpMult: 1.1, atkMult: 0.65, goldMult: 1.85, xpMult: 1.85, guaranteedRarity: 'mythic', flavor: 'Has swallowed kingdoms whole and remembers none of them.', ability: 'enrage' },
  { id: 'b_timeless', name: 'The Timeless One', title: 'Who Waits Beyond the Road', icon: '⏳', hpMult: 1.15, atkMult: 1.25, goldMult: 1.9, xpMult: 1.9, guaranteedRarity: 'mythic', flavor: 'It has already seen how this fight ends.', ability: 'reflect' },
  { id: 'b_omegasovereign', name: 'Null', title: 'the Omega Sovereign', icon: '♾️', hpMult: 0.9, atkMult: 0.7, goldMult: 2, xpMult: 2, guaranteedRarity: 'mythic', flavor: 'The last boss before the road loops on itself.', ability: 'enrage' }
];

/* ============================================================================
 * Boss scripts — phases, signature moves and passives.
 * A boss is not a big enemy: it changes the rules partway through the fight.
 *
 * Authoring limits (kept so every boss stays beatable at on-curve gear — see
 * `npm run sim -- 200 all bosses`):
 *   • phase attack multipliers ≤ 1.2, and at most Enrage (1) as a permanent buff
 *   • wind-up payoffs ≤ 2.8× (they are telegraphed and parry-able), heavies ≤ 2.2×
 *   • multi-hit moves total ≤ 2.4×, damage-over-time ≤ 4 stacks
 *   • heals ≤ 10% per use, phase-entry shields ≤ 2.4× attack
 * ========================================================================== */

export type BossPassive =
  | 'undying'
  | 'thorns'
  | 'siphon'
  | 'relentless'
  | 'adaptive'
  | 'hoarfrost'
  | 'echo'
  | 'devour'
  | 'rewind'
  | 'nullify';

export const PASSIVE_INFO: Record<BossPassive, { name: string; icon: string; description: string }> = {
  undying: { name: 'Undying', icon: '⚰️', description: 'Rises once at 35% HP when slain.' },
  thorns: { name: 'Thornmail', icon: '🌵', description: 'Reflects 15% of damage taken.' },
  siphon: { name: 'Siphon', icon: '🧛', description: 'Heals for 15% of damage dealt.' },
  relentless: { name: 'Relentless', icon: '📈', description: 'Gains +2% attack every turn.' },
  adaptive: { name: 'Adaptive Hide', icon: '🧱', description: 'Fortifies whenever it is crit (up to 3).' },
  hoarfrost: { name: 'Hoarfrost', icon: '❄️', description: 'Every hit chills you — Weaken (1), up to 3.' },
  echo: { name: 'Echo', icon: '🔁', description: 'Every third turn its move repeats at 60%.' },
  devour: { name: 'Devour', icon: '🍽️', description: 'Enrages whenever you heal a real chunk (up to 3).' },
  rewind: { name: 'Rewind', icon: '⏳', description: 'Once, below 40%, it rewinds to 55% HP.' },
  nullify: { name: 'Nullify', icon: '🚫', description: 'Strips your buffs on every phase change.' }
};

export interface PhaseEntry {
  healPct?: number;
  shieldFromAtk?: number;
  atkMult?: number;
  status?: StatusApplication;
  stripPlayerBuffs?: boolean;
}

export interface BossPhase {
  name: string;
  banner: string;
  /** Phase begins when HP falls to this fraction of max. Phase 1 is 1. */
  at: number;
  moves: EnemyMove[];
  onEnter?: PhaseEntry;
}

export interface BossScript {
  archetype: Archetype;
  passive?: BossPassive;
  phases: BossPhase[];
}

/* --------------------------------------------------------- move shorthands -- */

interface MoveOpts {
  hits?: number;
  weight?: number;
  pierce?: number;
  applies?: StatusApplication;
  applies2?: StatusApplication;
  healPct?: number;
  shieldFromAtk?: number;
  drain?: number;
  cooldown?: number;
  belowHp?: number;
  aboveHp?: number;
  notOpener?: boolean;
}

let uid = 0;
function move(
  kind: EnemyMove['kind'],
  label: string,
  icon: string,
  power: number,
  o: MoveOpts = {}
): EnemyMove {
  return { id: `bm${uid++}`, kind, label, icon, power, weight: o.weight ?? 50, ...o };
}
const hit = (l: string, i: string, p: number, o: MoveOpts = {}) => move('attack', l, i, p, { weight: 100, ...o });
const heavy = (l: string, i: string, p: number, o: MoveOpts = {}) => move('heavy', l, i, p, { cooldown: 2, ...o });
const guard = (l: string, i: string, o: MoveOpts = {}) => move('defend', l, i, 0, { cooldown: 3, ...o });
const buff = (l: string, i: string, o: MoveOpts = {}) => move('buff', l, i, 0, { cooldown: 4, ...o });
const hex = (l: string, i: string, p: number, o: MoveOpts = {}) => move('debuff', l, i, p, { cooldown: 3, ...o });
const mend = (l: string, i: string, o: MoveOpts = {}) => move('heal', l, i, 0, { cooldown: 4, ...o });

/** A wind-up telegraph and the devastating move it becomes next turn. */
function windup(
  label: string,
  payoffLabel: string,
  payoffIcon: string,
  power: number,
  o: MoveOpts = {}
): EnemyMove {
  return {
    id: `bm${uid++}`,
    kind: 'special',
    label,
    icon: '🌀',
    power: 0,
    weight: o.weight ?? 45,
    cooldown: o.cooldown ?? 3,
    belowHp: o.belowHp,
    aboveHp: o.aboveHp,
    notOpener: true,
    payoff: {
      kind: 'special',
      label: payoffLabel,
      icon: payoffIcon,
      power,
      pierce: o.pierce,
      hits: o.hits,
      applies: o.applies
    }
  };
}

const S = (
  status: StatusApplication['status'],
  stacks: number,
  turns: number,
  chance = 1,
  onSelf = false
): StatusApplication => ({ status, stacks, turns, chance, onSelf });

/* ------------------------------------------------------------- the scripts -- */

export const BOSS_SCRIPTS: Record<string, BossScript> = {
  b_ratking: {
    archetype: 'swarm',
    passive: 'echo',
    phases: [
      {
        name: 'The Crown',
        banner: 'The pile shifts and screeches.',
        at: 1,
        moves: [
          hit('Gnawing Tide', '🐀', 0.5, { hits: 3 }),
          heavy('Crown Charge', '👑', 1.6),
          hex('Filth Cloud', '🤢', 0.4, { applies: S('poison', 3, 4) })
        ]
      },
      {
        name: 'Swarming',
        banner: 'The crown splits — every rat is the Ratking now.',
        at: 0.5,
        onEnter: { status: S('enrage', 1, 99, 1, true), shieldFromAtk: 1.4 },
        moves: [
          hit('Endless Tide', '🐀', 0.45, { hits: 4 }),
          heavy('Bite Storm', '💢', 1.5, { applies: S('bleed', 2, 3) }),
          buff('Multiply', '➕', { healPct: 0.08, applies: S('enrage', 1, 4, 1, true) })
        ]
      }
    ]
  },
  b_goblinchief: {
    archetype: 'skirmisher',
    passive: 'relentless',
    phases: [
      {
        name: 'Warchief',
        banner: 'Grubnash bangs his blade on his shield.',
        at: 1,
        moves: [
          hit('Cleaver', '🔪', 1),
          heavy('Rally Strike', '💢', 1.7),
          buff('War Cry', '📣', { applies: S('enrage', 2, 3, 1, true) })
        ]
      },
      {
        name: 'Cornered',
        banner: 'His warband is dead. He fights like it.',
        at: 0.45,
        onEnter: { atkMult: 1.2 },
        moves: [
          hit('Frantic Hacks', '🔪', 0.6, { hits: 3 }),
          windup('Sharpening…', 'Chief Ender', '☄️', 2.4, { pierce: 0.5 }),
          heavy('Dirty Trick', '🪤', 1.4, { applies: S('stun', 1, 1, 0.4) })
        ]
      }
    ]
  },
  b_directwolf: {
    archetype: 'skirmisher',
    passive: 'relentless',
    phases: [
      {
        name: 'The Hunt',
        banner: 'Fenrik circles. He is faster than you.',
        at: 1,
        moves: [
          hit('Snap', '🐺', 0.95),
          hit('Savage Rake', '🩸', 0.7, { hits: 2, applies: S('bleed', 1, 3) }),
          guard('Circle', '🌫️', { shieldFromAtk: 1.6 })
        ]
      },
      {
        name: 'Blood Scent',
        banner: 'He tastes blood. The circling stops.',
        at: 0.5,
        onEnter: { atkMult: 1.15, status: S('enrage', 1, 99, 1, true) },
        moves: [
          hit('Throat Snap', '🐺', 1.2, { pierce: 0.4 }),
          heavy('Pounce', '💢', 1.7, { applies: S('bleed', 1, 3) }),
          windup('Coiling…', 'Ripping Frenzy', '🩸', 0.8, { hits: 4 })
        ]
      }
    ]
  },
  b_orcwarlord: {
    archetype: 'brute',
    passive: 'adaptive',
    phases: [
      {
        name: 'Warlord',
        banner: 'Grommash cracks his knuckles.',
        at: 1,
        moves: [
          hit('Hammerfist', '👊', 1),
          heavy('Shieldbreaker', '💢', 1.9, { pierce: 0.5 }),
          guard('Iron Stance', '🛡️', { shieldFromAtk: 1.5, applies: S('fortify', 2, 2, 1, true) })
        ]
      },
      {
        name: 'Unarmoured',
        banner: 'He tears off his own armour. He will not need it.',
        at: 0.55,
        onEnter: { atkMult: 1.2 },
        moves: [
          hit('Wild Haymaker', '👊', 1.2),
          windup('Roaring…', 'Warlord Slam', '☄️', 2.8),
          buff('Bloodrage', '😤', { applies: S('enrage', 2, 3, 1, true) })
        ]
      },
      {
        name: 'Last Stand',
        banner: 'A hundred shields. One more.',
        at: 0.2,
        onEnter: { shieldFromAtk: 1.6 },
        moves: [
          hit('Death Blows', '👊', 0.8, { hits: 3 }),
          heavy('Skullcrusher', '💀', 2.2, { pierce: 0.6 })
        ]
      }
    ]
  },
  b_wraithqueen: {
    archetype: 'phantom',
    passive: 'siphon',
    phases: [
      {
        name: 'The Veil',
        banner: 'The light on the road ahead goes out.',
        at: 1,
        moves: [
          hit('Grave Touch', '👻', 1.05, { pierce: 0.6 }),
          hex('Soulchill', '💫', 0.5, { applies: S('weaken', 2, 3) }),
          guard('Veil', '🌫️', { shieldFromAtk: 1.4 })
        ]
      },
      {
        name: 'Unveiled',
        banner: 'Morwen steps out of her own shadow.',
        at: 0.5,
        onEnter: { healPct: 0.06, stripPlayerBuffs: true },
        moves: [
          hit('Spectral Rend', '👻', 1.15, { pierce: 0.8, drain: 0.3 }),
          windup('Keening…', "Queen's Wail", '💠', 2.5, { applies: S('stun', 1, 1, 0.6) }),
          mend('Devour Light', '💚', { healPct: 0.07 })
        ]
      }
    ]
  },
  b_stonetitan: {
    archetype: 'warden',
    passive: 'thorns',
    phases: [
      {
        name: 'Immovable',
        banner: 'Gravemaw does not move. It waits.',
        at: 1,
        moves: [
          hit('Boulder Fist', '🗿', 1),
          guard('Petrify', '🛡️', { shieldFromAtk: 1.4, applies: S('fortify', 2, 3, 1, true), weight: 50 }),
          heavy('Ground Split', '💢', 1.8, { applies: S('stun', 1, 1, 0.3) })
        ]
      },
      {
        name: 'Cracked Open',
        banner: 'A fissure opens across its chest. Something glows.',
        at: 0.45,
        onEnter: { atkMult: 1.2 },
        moves: [
          hit('Magma Fist', '🌋', 1.2, { applies: S('burn', 2, 3) }),
          windup('Rumbling…', 'Avalanche', '☄️', 2.8),
          mend('Reform', '💚', { healPct: 0.07 })
        ]
      }
    ]
  },
  b_wyvernlord: {
    archetype: 'venom',
    passive: 'relentless',
    phases: [
      {
        name: 'Circling',
        banner: 'Skarrix banks above the road.',
        at: 1,
        moves: [
          hit('Tail Lash', '🐲', 0.95),
          hex('Venom Spray', '☠️', 0.6, { applies: S('poison', 2, 3) }),
          windup('Climbing…', 'Diving Talons', '☄️', 2.0, { pierce: 0.5 })
        ]
      },
      {
        name: 'Grounded',
        banner: 'It lands. The ground is worse for you than the sky.',
        at: 0.45,
        onEnter: { atkMult: 1.1 },
        moves: [
          hit('Rending Jaws', '🐲', 1.25, { applies: S('bleed', 1, 3) }),
          heavy('Wing Buffet', '💢', 1.5, { applies: S('stun', 1, 1, 0.35) }),
          hex('Toxic Flood', '☠️', 0.7, { applies: S('poison', 2, 3) })
        ]
      }
    ]
  },
  b_lich: {
    archetype: 'caster',
    passive: 'undying',
    phases: [
      {
        name: 'The Undying',
        banner: 'Azharok has died before. He remembers it.',
        at: 1,
        moves: [
          hit('Shadow Bolt', '🔮', 1.15, { pierce: 0.6 }),
          hex('Curse of Ash', '🔻', 0.5, { applies: S('weaken', 2, 3), applies2: S('burn', 2, 3) }),
          windup('Channelling…', 'Soul Nova', '💠', 2.4, { pierce: 0.8 })
        ]
      },
      {
        name: 'Phylactery',
        banner: 'His phylactery burns cold. He is only getting started.',
        at: 0.4,
        onEnter: { shieldFromAtk: 1.5, healPct: 0.06 },
        moves: [
          hit('Drain Essence', '🧛', 1.2, { drain: 0.5 }),
          heavy('Bone Storm', '💀', 1.2, { hits: 2 }),
          mend('Consume Dead', '💚', { healPct: 0.06 })
        ]
      }
    ]
  },
  b_hydra: {
    archetype: 'venom',
    passive: 'relentless',
    phases: [
      {
        name: 'Nine Heads',
        banner: 'Nine heads. Nine ways this goes badly.',
        at: 1,
        moves: [
          hit('Head Strike', '🐍', 0.6, { hits: 3 }),
          hex('Acid Spit', '☠️', 0.55, { applies: S('poison', 2, 4) }),
          heavy('Constrict', '💢', 1.5, { applies: S('stun', 1, 1, 0.3) })
        ]
      },
      {
        name: 'Regrowth',
        banner: 'You cut one head. Two more count the loss.',
        at: 0.6,
        onEnter: { healPct: 0.1, status: S('enrage', 1, 99, 1, true) },
        moves: [
          hit('Twin Bite', '🐍', 0.65, { hits: 3, applies: S('poison', 2, 3, 0.4) }),
          mend('Regrow', '💚', { healPct: 0.06, cooldown: 3 }),
          windup('Rearing…', 'Nine-Fold Bite', '☄️', 0.55, { hits: 5 })
        ]
      },
      {
        name: 'Rot',
        banner: 'The stumps stop growing back. It stops caring.',
        at: 0.25,
        onEnter: { atkMult: 1.2 },
        moves: [
          hit('Death Rattle', '🐍', 1.4, { pierce: 0.5 }),
          hex('Plague Cloud', '☠️', 0.9, { applies: S('poison', 3, 4) })
        ]
      }
    ]
  },
  b_voidherald: {
    archetype: 'caster',
    passive: 'thorns',
    phases: [
      {
        name: 'The Herald',
        banner: 'The road ends where it stands.',
        at: 1,
        moves: [
          hit('Void Lash', '🌌', 1.1, { pierce: 0.7 }),
          hex('Unmake', '🔻', 0.6, { applies: S('weaken', 2, 3) }),
          guard('Null Field', '🛡️', { shieldFromAtk: 1.6 })
        ]
      },
      {
        name: 'Unmaking',
        banner: 'Reality declines to continue.',
        at: 0.5,
        onEnter: { stripPlayerBuffs: true, atkMult: 1.15 },
        moves: [
          hit('Entropy', '🌌', 1.15, { pierce: 1 }),
          windup('Collapsing…', 'Event Horizon', '🕳️', 2.6, { pierce: 1 }),
          mend('Consume Light', '💚', { healPct: 0.07 })
        ]
      }
    ]
  },
  b_thornqueen: {
    archetype: 'venom',
    passive: 'thorns',
    phases: [
      {
        name: 'The Garden',
        banner: 'Roots crawl across the road toward you.',
        at: 1,
        moves: [
          hit('Thorn Whip', '🥀', 1, { applies: S('bleed', 2, 3, 0.6) }),
          hex('Pollen', '☠️', 0.5, { applies: S('poison', 3, 4) }),
          guard('Bramble Wall', '🛡️', { shieldFromAtk: 1.6 })
        ]
      },
      {
        name: 'Bloom',
        banner: 'Ysolde blooms. Everything she touches dies.',
        at: 0.45,
        onEnter: { healPct: 0.08, status: S('regen', 1, 6, 1, true) },
        moves: [
          hit('Impaling Vines', '🌿', 1.1, { hits: 2, pierce: 0.4 }),
          windup('Blossoming…', 'Thornburst', '☄️', 2.4, { applies: S('bleed', 3, 4) }),
          mend('Photosynthesis', '💚', { healPct: 0.07 })
        ]
      }
    ]
  },
  b_juggernaut: {
    archetype: 'warden',
    passive: 'adaptive',
    phases: [
      {
        name: 'Vanguard',
        banner: 'Servos whine. Targeting lock acquired.',
        at: 1,
        moves: [
          hit('Piston Punch', '🤖', 1.05),
          guard('Plating Online', '🛡️', { shieldFromAtk: 1.5, applies: S('fortify', 2, 3, 1, true) }),
          heavy('Siege Cannon', '💢', 2.0, { pierce: 0.6 })
        ]
      },
      {
        name: 'Overclocked',
        banner: 'SAFETY PROTOCOLS DISENGAGED.',
        at: 0.5,
        onEnter: { atkMult: 1.2 },
        moves: [
          hit('Autocannon', '🔫', 0.5, { hits: 4 }),
          windup('Charging core…', 'Annihilation Beam', '☄️', 2.6, { pierce: 0.8 }),
          buff('Overdrive', '😤', { applies: S('enrage', 2, 3, 1, true) })
        ]
      }
    ]
  },
  b_stormcaller: {
    archetype: 'caster',
    passive: 'echo',
    phases: [
      {
        name: 'Gathering',
        banner: 'Thunder answers before he speaks.',
        at: 1,
        moves: [
          hit('Arc Lash', '⚡', 1.05, { pierce: 0.6 }),
          hex('Static Field', '💫', 0.5, { applies: S('stun', 1, 1, 0.4) }),
          windup('Calling the sky…', 'Thunderstrike', '🌩️', 2.4, { pierce: 0.7 })
        ]
      },
      {
        name: 'The Storm',
        banner: 'Kaelen stops calling the storm. The storm calls him.',
        at: 0.45,
        onEnter: { atkMult: 1.15, status: S('enrage', 1, 99, 1, true) },
        moves: [
          hit('Chain Lightning', '⚡', 0.6, { hits: 3, pierce: 0.5 }),
          heavy('Downburst', '💢', 2.0, { applies: S('stun', 1, 1, 0.4) }),
          guard('Stormshroud', '🛡️', { shieldFromAtk: 1.5 })
        ]
      }
    ]
  },
  b_abysslord: {
    archetype: 'leech',
    passive: 'siphon',
    phases: [
      {
        name: 'The Depths',
        banner: 'Something down there finally noticed you.',
        at: 1,
        moves: [
          hit('Grasping Dark', '🕳️', 1.05, { drain: 0.3 }),
          hex('Dread', '🔻', 0.5, { applies: S('weaken', 2, 3) }),
          heavy('Abyssal Maw', '💢', 1.85, { drain: 0.4 })
        ]
      },
      {
        name: 'Surfacing',
        banner: 'It rises. There is more of it than the road can hold.',
        at: 0.5,
        onEnter: { healPct: 0.08, atkMult: 1.15 },
        moves: [
          hit('Devouring Tide', '🌊', 0.65, { hits: 3, drain: 0.3 }),
          windup('Inhaling…', 'Swallow Whole', '☄️', 2.5, { pierce: 0.6 }),
          mend('Digest', '💚', { healPct: 0.07 })
        ]
      }
    ]
  },
  b_frostmonarch: {
    archetype: 'caster',
    passive: 'hoarfrost',
    phases: [
      {
        name: 'Winter Court',
        banner: 'The air stops moving. Then so does the road.',
        at: 1,
        moves: [
          hit('Frost Lance', '🥶', 1.05, { pierce: 0.5 }),
          hex('Deep Freeze', '❄️', 0.55, { applies: S('stun', 1, 1, 0.5) }),
          guard('Ice Wall', '🛡️', { shieldFromAtk: 1.6 })
        ]
      },
      {
        name: 'Endless Winter',
        banner: 'Sythera stands. Her throne freezes over behind her.',
        at: 0.45,
        onEnter: { atkMult: 1.15, status: S('fortify', 2, 99, 1, true) },
        moves: [
          hit('Shatterstorm', '❄️', 0.7, { hits: 3 }),
          windup('The cold deepens…', 'Absolute Zero', '☄️', 2.5, { applies: S('stun', 1, 1, 0.7) }),
          mend('Frozen Heart', '💚', { healPct: 0.07 })
        ]
      }
    ]
  },
  b_bloodreaver: {
    archetype: 'leech',
    passive: 'devour',
    phases: [
      {
        name: 'The Reaver',
        banner: 'Karn counts his kills. You are a number.',
        at: 1,
        moves: [
          hit('Reaving Blade', '🩸', 1.1, { applies: S('bleed', 1, 3) }),
          heavy('Blood Harvest', '💢', 1.9, { drain: 0.3 }),
          buff('Blood Frenzy', '😤', { applies: S('enrage', 2, 3, 1, true) })
        ]
      },
      {
        name: 'Crimson',
        banner: 'His blade is the right colour now.',
        at: 0.5,
        onEnter: { atkMult: 1.2, healPct: 0.08 },
        moves: [
          hit('Exsanguinate', '🩸', 0.6, { hits: 3, applies: S('bleed', 2, 3, 0.5) }),
          windup('Savouring…', 'Crimson Execution', '☄️', 2.6, { pierce: 0.7 }),
          mend('Drink Deep', '💚', { healPct: 0.07 })
        ]
      }
    ]
  },
  b_starweaver: {
    archetype: 'caster',
    passive: 'nullify',
    phases: [
      {
        name: 'The Loom',
        banner: 'Alune stitches your fate into her pattern.',
        at: 1,
        moves: [
          hit('Fate Thread', '🌠', 1.05, { pierce: 0.6 }),
          hex('Unravel', '🔻', 0.55, { applies: S('weaken', 2, 3) }),
          guard('Woven Ward', '🛡️', { shieldFromAtk: 1.4 })
        ]
      },
      {
        name: 'Rewoven',
        banner: 'She pulls a thread. Something you had is gone.',
        at: 0.55,
        onEnter: { stripPlayerBuffs: true, healPct: 0.08 },
        moves: [
          hit('Starfall', '⭐', 0.6, { hits: 4, pierce: 0.4 }),
          windup('Weaving…', 'Constellation', '☄️', 2.6, { pierce: 0.8 }),
          mend('Mend Fate', '💚', { healPct: 0.07 })
        ]
      }
    ]
  },
  b_worldeater: {
    archetype: 'brute',
    passive: 'relentless',
    phases: [
      {
        name: 'Waking',
        banner: 'Chthon has swallowed kingdoms and remembers none.',
        at: 1,
        moves: [
          hit('Magma Fist', '🌋', 1.1, { applies: S('burn', 2, 3, 0.6) }),
          heavy('Tectonic Slam', '💢', 1.8),
          buff('Molten Rage', '😤', { applies: S('enrage', 2, 3, 1, true) })
        ]
      },
      {
        name: 'Feeding',
        banner: 'It opens. The horizon tilts toward the mouth.',
        at: 0.6,
        onEnter: { atkMult: 1.15 },
        moves: [
          hit('Ash Storm', '🔥', 0.6, { hits: 3, applies: S('burn', 2, 3, 0.3) }),
          windup('Inhaling the world…', 'Devour', '☄️', 2.4, { pierce: 0.7 }),
          mend('Consume', '💚', { healPct: 0.07 })
        ]
      },
      {
        name: 'Eruption',
        banner: 'Everything it ever ate comes back out at once.',
        at: 0.25,
        onEnter: { atkMult: 1.15 },
        moves: [
          hit('Cataclysm', '🌋', 1.3, { pierce: 0.6, applies: S('burn', 1, 3) }),
          heavy('World Break', '☄️', 2.2, { pierce: 0.8 })
        ]
      }
    ]
  },
  b_timeless: {
    archetype: 'phantom',
    passive: 'rewind',
    phases: [
      {
        name: 'Already Seen',
        banner: 'It has already watched how this ends.',
        at: 1,
        moves: [
          hit('Foreseen Strike', '⏳', 1.1, { pierce: 0.7 }),
          hex('Stasis', '💫', 0.5, { applies: S('stun', 1, 1, 0.5) }),
          guard('Loop', '🛡️', { shieldFromAtk: 1.5 })
        ]
      },
      {
        name: 'Rewritten',
        banner: 'It corrects a mistake it has not made yet.',
        at: 0.5,
        onEnter: { stripPlayerBuffs: true, atkMult: 1.15 },
        moves: [
          hit('Cascade', '⏳', 0.6, { hits: 3, pierce: 0.5 }),
          windup('Winding back…', 'Endpoint', '☄️', 2.6, { pierce: 0.9 }),
          mend('Restore', '💚', { healPct: 0.07 })
        ]
      }
    ]
  },
  b_omegasovereign: {
    archetype: 'warden',
    passive: 'undying',
    phases: [
      {
        name: 'Sovereign',
        banner: 'Null regards you. The road holds its breath.',
        at: 1,
        moves: [
          hit('Omega Strike', '♾️', 1.15, { pierce: 0.5 }),
          guard('Absolute Guard', '🛡️', { shieldFromAtk: 1.0, applies: S('fortify', 1, 3, 1, true) }),
          heavy('Erasure', '💢', 1.9, { pierce: 0.6 })
        ]
      },
      {
        name: 'Ascendant',
        banner: 'It stops pretending to have limits.',
        at: 0.6,
        onEnter: { atkMult: 1.15, stripPlayerBuffs: true },
        moves: [
          hit('Cascade Failure', '♾️', 0.5, { hits: 4, pierce: 0.5 }),
          windup('Zeroing…', 'Total Erasure', '☄️', 2.6, { pierce: 0.8 }),
          hex('Silence', '🔻', 0.7, { applies: S('weaken', 2, 2) })
        ]
      },
      {
        name: 'Omega',
        banner: 'The last boss before the road loops on itself.',
        at: 0.25,
        onEnter: { healPct: 0.08, status: S('enrage', 1, 99, 1, true), shieldFromAtk: 1.4 },
        moves: [
          hit('End of Line', '♾️', 1.2, { pierce: 0.7 }),
          heavy('Null', '⚫', 2.2, { pierce: 0.8 })
        ]
      }
    ]
  }
};

/** Fallback for any boss without an authored script. */
export const DEFAULT_BOSS_SCRIPT: BossScript = {
  archetype: 'brute',
  phases: [
    {
      name: 'Assault',
      banner: 'It moves to block the road.',
      at: 1,
      moves: [hit('Strike', '⚔️', 1), heavy('Heavy Blow', '💢', 1.8), guard('Guard', '🛡️', { shieldFromAtk: 1.4 })]
    },
    {
      name: 'Desperate',
      banner: 'It stops holding back.',
      at: 0.45,
      onEnter: { atkMult: 1.2 },
      moves: [hit('Frenzy', '⚔️', 0.9, { hits: 2 }), windup('Winding up…', 'Finisher', '☄️', 2.6)]
    }
  ]
};

export function bossScript(id: string): BossScript {
  return BOSS_SCRIPTS[id] ?? DEFAULT_BOSS_SCRIPT;
}

export function bossBaseById(id: string): BossBase | undefined {
  return BOSS_BASES.find(b => b.id === id);
}

/**
 * Boss numbers relative to an on-level normal enemy. A boss is a long fight
 * with phases that heal and shield, so its HP is several fights' worth and
 * its attack sits between a normal and an elite (phases multiply it later).
 */
export const BOSS_TUNING = {
  /** HP / attack relative to the level nominal, growing with level (see ENEMY_TUNING for why). */
  hp: 1.5,
  hpPerLevel: 0.005,
  atk: 1.2,
  atkPerLevel: 0.01,
  def: 1.5,
  gold: 5,
  xp: 5,
  /** Extra strength per full loop of the roster (Rank 2, 3…). */
  loopGrowth: 0.1
};

export function pickBoss(worldCycle: number, level: number): EnemyInstance {
  const idx = worldCycle % BOSS_BASES.length;
  const loop = Math.floor(worldCycle / BOSS_BASES.length);
  const base = BOSS_BASES[idx];
  const B = BOSS_TUNING;
  const rank = 1 + loop * B.loopGrowth;
  const hp = Math.round(nominalHp(level) * (B.hp + B.hpPerLevel * level) * base.hpMult * rank);
  const atk = Math.round(nominalAtk(level) * (B.atk + B.atkPerLevel * level) * base.atkMult * rank);
  const gold = Math.round(nominalGold(level) * B.gold * base.goldMult * rank);
  const xp = Math.round(nominalXp(level) * B.xp * base.xpMult * rank);
  const baseTitle = cfield('boss', base.id, 'title', base.title);
  const title = loop > 0 ? t('data.boss_rank', { title: baseTitle, n: loop + 1 }) : baseTitle;
  return {
    id: base.id,
    name: cname('boss', base.id, base.name),
    icon: base.icon,
    hp,
    maxHp: hp,
    atk,
    def: Math.round(nominalDef(level) * B.def * rank),
    goldReward: gold,
    xpReward: xp,
    isBoss: true,
    isElite: false,
    guaranteedRarity: base.guaranteedRarity,
    title,
    ability: base.ability,
    phases: bossScript(base.id)
      .phases.slice(1)
      .map(p => p.at),
    statuses: [],
    shield: 0
  };
}

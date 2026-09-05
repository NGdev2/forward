import type { Danger, EncounterNode, EnemyInstance, NodeKind, Rarity } from './types';
import type { GameState } from './state';
import { pickEnemy } from './data/enemies';

/* ============================================================================
 * Lane generation for the run screen.
 *
 * The goal is that every set of three lanes is a *decision*, not a lottery:
 *  - one lane is always comparatively safe, one is always comparatively risky,
 *  - rewards are telegraphed (the player sees roughly what they're playing for),
 *  - streak / pity rules stop the run from stalling (no campfire while dying,
 *    no fourth chest in a row, a trader shows up when you're rich).
 * ========================================================================== */

/** An encounter with everything the run screen needs to draw and resolve it. */
export interface RunEncounter extends EncounterNode {
  /** Short telegraph of what this lane pays out, e.g. "+140g" or "Rare loot". */
  rewardHint: string;
  /** Optional flag shown on the marker: RISK / SAFE / RARE. */
  tag?: string;
  /** Pre-rolled opponent for fight lanes, so the marker shows who you'll face. */
  enemy?: EnemyInstance;
  gold?: number;
  xp?: number;
  heal?: number;
  lootCount?: number;
  lootRarity?: Rarity;
}

interface KindDef {
  kind: NodeKind;
  weight: number;
  minLevel: number;
  icon: string;
  title: string;
  subtitle: string;
  danger: Danger;
}

const KINDS: KindDef[] = [
  { kind: 'battle', weight: 34, minLevel: 1, icon: '⚔️', title: 'Prowler', subtitle: 'A fight on the road', danger: 1 },
  { kind: 'gold', weight: 20, minLevel: 1, icon: '💰', title: 'Coin Cache', subtitle: 'Spilled purse', danger: 0 },
  { kind: 'treasure', weight: 17, minLevel: 1, icon: '🧰', title: 'Chest', subtitle: 'Something inside', danger: 0 },
  { kind: 'rest', weight: 11, minLevel: 1, icon: '🏕️', title: 'Campfire', subtitle: 'Catch your breath', danger: 0 },
  { kind: 'elite', weight: 10, minLevel: 3, icon: '☠️', title: 'Elite', subtitle: 'Deadly. Rich.', danger: 3 },
  { kind: 'shrine', weight: 9, minLevel: 3, icon: '🔮', title: 'Shrine', subtitle: 'Pay the price', danger: 1 },
  { kind: 'shop', weight: 8, minLevel: 2, icon: '🏪', title: 'Trader', subtitle: 'Spend your gold', danger: 0 },
  { kind: 'mystery', weight: 8, minLevel: 2, icon: '❓', title: 'Unknown', subtitle: 'Could be anything', danger: 2 }
];

const SAFE_KINDS: NodeKind[] = ['gold', 'treasure', 'rest', 'shop'];
const FIGHT_KINDS: NodeKind[] = ['battle', 'elite'];

/* ------------------------------------------------------------- run memory -- */

/**
 * Short-term memory of the run. Lives for the session (the run screen is
 * mounted and unmounted repeatedly, so it can't hang off the screen itself).
 */
export interface RunMemory {
  /** Kinds chosen, newest last. */
  history: NodeKind[];
  /** Nodes since the last campfire / trader, for pity rules. */
  sinceRest: number;
  sinceShop: number;
  sinceElite: number;
  /** Consecutive fights taken — feeds the "bloodthirst" bonus. */
  fightStreak: number;
  /** Consecutive fights dodged — makes safe lanes progressively stingier. */
  cowardStreak: number;
  nodesSeen: number;
}

export function freshMemory(): RunMemory {
  return {
    history: [],
    sinceRest: 0,
    sinceShop: 0,
    sinceElite: 0,
    fightStreak: 0,
    cowardStreak: 0,
    nodesSeen: 0
  };
}

let memory: RunMemory = freshMemory();

export function runMemory(): RunMemory {
  return memory;
}

export function resetRunMemory() {
  memory = freshMemory();
}

/** Called by the run screen once the player commits to a lane. */
export function rememberChoice(kind: NodeKind) {
  memory.history.push(kind);
  if (memory.history.length > 12) memory.history.shift();
  memory.nodesSeen += 1;
  memory.sinceRest = kind === 'rest' ? 0 : memory.sinceRest + 1;
  memory.sinceShop = kind === 'shop' ? 0 : memory.sinceShop + 1;
  memory.sinceElite = kind === 'elite' ? 0 : memory.sinceElite + 1;
  if (FIGHT_KINDS.includes(kind)) {
    memory.fightStreak += 1;
    memory.cowardStreak = 0;
  } else {
    memory.cowardStreak += 1;
    memory.fightStreak = 0;
  }
}

/* ------------------------------------------------------------- weighting -- */

function contextWeight(def: KindDef, state: GameState): number {
  const s = state.stats;
  const hpFrac = s.hp / Math.max(1, state.maxHp);
  const toBoss = s.progressMax - s.progress;
  let w = def.weight;

  switch (def.kind) {
    case 'rest':
      // Wounded runners see far more campfires; healthy ones almost none.
      w *= hpFrac < 0.35 ? 3.4 : hpFrac < 0.7 ? 1.5 : 0.45;
      if (memory.sinceRest > 6) w *= 2;
      break;
    case 'shop':
      w *= s.gold > 120 ? 1.5 : 0.5;
      if (memory.sinceShop > 8) w *= 2.4;
      if (state.bagFull) w *= 1.8;
      break;
    case 'treasure':
      // Nothing to gain from loot you can't carry.
      if (state.bagFull) w *= 0.25;
      // Reward the player for taking fights.
      w *= 1 + memory.fightStreak * 0.35;
      break;
    case 'gold':
      if (state.bagFull) w *= 1.6;
      break;
    case 'elite':
      w *= hpFrac < 0.45 ? 0.35 : 1;
      if (memory.sinceElite > 7) w *= 1.8;
      // One step before the boss, elites are the last big power spike.
      if (toBoss <= 1) w *= 1.5;
      break;
    case 'battle':
      // Dodging fights makes the road hungrier.
      w *= 1 + memory.cowardStreak * 0.4;
      break;
    case 'mystery':
      w *= 1 + memory.nodesSeen * 0.02;
      break;
    default:
      break;
  }
  // Never repeat the last thing you just did.
  if (memory.history[memory.history.length - 1] === def.kind) w *= 0.35;
  return Math.max(0.5, w);
}

function pickWeighted(pool: KindDef[], state: GameState): KindDef {
  const entries = pool.map(def => ({ def, w: contextWeight(def, state) }));
  const total = entries.reduce((sum, e) => sum + e.w, 0);
  let roll = Math.random() * total;
  for (const e of entries) {
    if (roll < e.w) return e.def;
    roll -= e.w;
  }
  return entries[entries.length - 1].def;
}

/* --------------------------------------------------------------- payload -- */

function rnd(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Baseline value of one encounter at the player's current power. */
function tierValue(state: GameState): number {
  const s = state.stats;
  return 8 + s.level * 4.5 + s.worldCycle * 14;
}

function dress(def: KindDef, lane: number, state: GameState): RunEncounter {
  const base = tierValue(state);
  const node: RunEncounter = {
    kind: def.kind,
    icon: def.icon,
    title: def.title,
    subtitle: def.subtitle,
    danger: def.danger,
    lane,
    rewardHint: ''
  };

  switch (def.kind) {
    case 'battle': {
      const enemy = pickEnemy(state.stats.level, false);
      node.enemy = enemy;
      node.title = enemy.name;
      node.icon = enemy.icon;
      node.subtitle = `${enemy.maxHp} HP · ${enemy.atk} ATK`;
      node.rewardHint = `+${enemy.xpReward} XP · ${enemy.goldReward}g`;
      // Danger scales with how hard the enemy hits relative to your HP.
      const threat = enemy.atk / Math.max(1, state.derived.def + 4);
      node.danger = threat > 2.4 ? 2 : 1;
      if (memory.cowardStreak >= 3) node.tag = 'BLOOD DEBT';
      break;
    }
    case 'elite': {
      const enemy = pickEnemy(state.stats.level + 1, true);
      node.enemy = enemy;
      node.title = enemy.name;
      node.icon = '☠️';
      node.subtitle = `${enemy.maxHp} HP · ${enemy.atk} ATK`;
      node.rewardHint = `Rare drop · ${enemy.goldReward}g`;
      node.danger = 3;
      node.tag = 'RISK';
      break;
    }
    case 'gold': {
      const gold = Math.round(base * rnd(1.1, 1.9));
      node.gold = gold;
      node.xp = Math.round(base * 0.15);
      node.rewardHint = `+${gold}g`;
      node.tag = 'SAFE';
      break;
    }
    case 'treasure': {
      const rich = Math.random() < 0.22 + state.luck * 0.01;
      node.lootCount = rich ? 2 : 1;
      node.gold = Math.round(base * rnd(0.2, 0.5));
      node.xp = Math.round(base * 0.2);
      if (rich) {
        node.lootRarity = 'rare';
        node.title = 'Gilded Chest';
        node.rewardHint = '2 items · rare+';
        node.tag = 'RARE';
      } else {
        node.rewardHint = '1 item';
      }
      break;
    }
    case 'rest': {
      const frac = 0.4 + Math.random() * 0.2;
      node.heal = Math.round(state.maxHp * frac);
      node.rewardHint = `Heal ${Math.round(frac * 100)}%`;
      node.tag = 'SAFE';
      break;
    }
    case 'shrine': {
      // Gamble: a big payout, but the shrine takes a bite of your HP.
      const gold = Math.round(base * rnd(1.8, 3.2));
      node.gold = gold;
      node.xp = Math.round(base * 0.9);
      node.lootCount = Math.random() < 0.4 ? 1 : 0;
      node.subtitle = 'Offer blood for fortune';
      node.rewardHint = `${gold}g · big XP`;
      node.danger = 1;
      break;
    }
    case 'shop': {
      node.rewardHint = 'Buy · sell · repair';
      node.tag = 'SAFE';
      break;
    }
    case 'mystery': {
      node.rewardHint = '???';
      node.subtitle = 'Half of these bite';
      node.danger = 2;
      break;
    }
    default:
      break;
  }
  return node;
}

/* ----------------------------------------------------------------- public -- */

/**
 * Three distinct lanes for the next stretch of road. Guarantees a spread of
 * risk: at least one low-danger lane and at least one high-danger lane, so the
 * player is always trading safety against reward rather than guessing.
 */
export function generateChoices(state: GameState): RunEncounter[] {
  const level = state.stats.level;
  const available = KINDS.filter(k => k.minLevel <= level);
  const used: NodeKind[] = [];
  const picks: KindDef[] = [];

  for (let i = 0; i < 3; i++) {
    let pool = available.filter(k => !used.includes(k.kind));
    if (i === 2) {
      // Force the spread on the last slot if the first two didn't provide it.
      const haveSafe = picks.some(p => SAFE_KINDS.includes(p.kind));
      const haveRisk = picks.some(p => p.danger >= 2 || FIGHT_KINDS.includes(p.kind));
      if (!haveSafe) {
        const safe = pool.filter(k => SAFE_KINDS.includes(k.kind));
        if (safe.length) pool = safe;
      } else if (!haveRisk) {
        const risky = pool.filter(k => k.danger >= 2 || FIGHT_KINDS.includes(k.kind));
        if (risky.length) pool = risky;
      }
    }
    if (pool.length === 0) pool = available;
    const def = pickWeighted(pool, state);
    used.push(def.kind);
    picks.push(def);
  }

  // Emergency pity: nearly dead with no way to heal — swap the safest lane.
  const hpFrac = state.stats.hp / Math.max(1, state.maxHp);
  if (hpFrac < 0.3 && !picks.some(p => p.kind === 'rest') && memory.sinceRest >= 2) {
    const rest = KINDS.find(k => k.kind === 'rest')!;
    let idx = picks.findIndex(p => p.kind === 'gold' || p.kind === 'shop');
    if (idx < 0) idx = picks.findIndex(p => p.danger === Math.min(...picks.map(q => q.danger)));
    picks[idx] = rest;
  }

  // Shuffle so the safe lane isn't always in the same place.
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }

  return picks.map((def, lane) => dress(def, lane, state));
}

/** Resolves what a mystery lane actually turns out to be, on arrival. */
export function resolveMystery(state: GameState): RunEncounter {
  const roll = Math.random();
  const base = tierValue(state);
  if (roll < 0.38) {
    const enemy = pickEnemy(state.stats.level, Math.random() < 0.3);
    return {
      kind: enemy.isElite ? 'elite' : 'battle',
      icon: enemy.icon,
      title: 'Ambush!',
      subtitle: enemy.name,
      danger: 3,
      lane: 1,
      rewardHint: `+${enemy.xpReward} XP`,
      enemy
    };
  }
  if (roll < 0.62) {
    const gold = Math.round(base * rnd(2.0, 3.4));
    return {
      kind: 'gold',
      icon: '💎',
      title: 'Buried Hoard',
      subtitle: 'The unknown paid out',
      danger: 0,
      lane: 1,
      rewardHint: `+${gold}g`,
      gold,
      xp: Math.round(base * 0.4)
    };
  }
  if (roll < 0.85) {
    return {
      kind: 'treasure',
      icon: '🎁',
      title: 'Strange Cache',
      subtitle: 'Wrapped in old cloth',
      danger: 0,
      lane: 1,
      rewardHint: '2 items',
      lootCount: 2,
      xp: Math.round(base * 0.3)
    };
  }
  return {
    kind: 'rest',
    icon: '⛲',
    title: 'Hidden Spring',
    subtitle: 'Clean water, for once',
    danger: 0,
    lane: 1,
    rewardHint: 'Full heal',
    heal: state.maxHp,
    xp: Math.round(base * 0.2)
  };
}

export function bossNode(): RunEncounter {
  return {
    kind: 'boss',
    icon: '👑',
    title: 'The road is blocked',
    subtitle: 'No lane leads around this',
    danger: 3,
    lane: 1,
    rewardHint: 'Guaranteed drop',
    tag: 'BOSS'
  };
}

/* ============================================================================
 * Headless balance simulator.
 *
 *   npm run sim                 # full table (300 fights per cell, P = 0.35 and 0.7)
 *   npm run sim -- 100          # fewer fights per cell
 *   npm run sim -- 300 5,12,20  # only these levels
 *   npm run sim -- 300 all xp   # also print the XP-curve table
 *
 * Bundled with esbuild and run under node — no browser, no DOM. The bot plays
 * an "average" (P = 0.35) and a "good" (P = 0.7) parry timing, uses the best
 * affordable ability, braces against big telegraphed hits and drinks a potion
 * when low. Gear is the starting kit plus the best of 2 + 1.2·L loot rolls (cap
 * 30) at the fight's level, talents spent evenly: what a player actually wears.
 * ========================================================================== */

// --- environment shims (must run before any GameState is constructed) -------
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear()
};

import { GameState } from '../src/game/state';
import { Combat, type PlayerAction, type ParryResult } from '../src/game/combat';
import { pickEnemy } from '../src/game/data/enemies';
import { pickBoss } from '../src/game/data/bosses';
import { rollLoot } from '../src/game/loot';
import { COMBAT, XP_CURVE } from '../src/game/config';
import { EQUIP_SLOTS, TALENT_KEYS, type EnemyInstance, type ItemInstance } from '../src/game/types';

type FightType = 'normal' | 'elite' | 'boss';

const argv = process.argv.slice(2);
const FIGHTS = Number(argv[0]) || 300;
const LEVELS = argv[1] && argv[1] !== 'all' ? argv[1].split(',').map(Number) : [1, 3, 5, 8, 12, 16, 20, 25, 30, 35, 40];
const SHOW_XP = argv.includes('xp');
const BOSS_MODE = argv.includes('bosses');
/** `trace <bossIdx>` plays one boss fight and prints every round. */
const TRACE = argv.indexOf('trace') >= 0 ? Number(argv[argv.indexOf('trace') + 1]) : -1;
const PARRIES = [0.35, 0.7];
const TYPES: FightType[] = ['normal', 'elite', 'boss'];

/* ----------------------------------------------------------------- player -- */

function makePlayer(level: number): GameState {
  const s = new GameState();
  s.reset();
  for (let i = 1; i < level; i++) s.addXp(s.stats.xpToNext);
  let t = 0;
  while (s.stats.statPoints > 0) s.spendTalent(TALENT_KEYS[t++ % TALENT_KEYS.length]);

  // Realistic gear: the starting kit (worn by freshStats) plus the best of the
  // drops a player has actually seen by this level — 2 + 1.2·L rolls, capped at 30,
  // spread across slots. A slot that never dropped stays empty (or keeps the kit).
  const rolls = Math.min(30, Math.round(2 + 1.2 * level));
  const drops = rollLoot(rolls, level, s.luck);
  for (const slot of EQUIP_SLOTS) {
    let best: ItemInstance | null = s.stats.equipment[slot];
    for (const it of drops) if (it.slot === slot && (!best || it.power > best.power)) best = it;
    if (best) s.stats.equipment[slot] = best;
  }
  s.stats.consumables = level < 10 ? { potion_small: 2 } : { potion_large: 1 };
  s.healFull();
  return s;
}

/**
 * Where the boss bar sits at a given level, from the XP curve (3 + 0.25·L
 * fights per level) and the boss bar (6 + cycle/2 fights per cycle).
 */
function cycleForLevel(level: number): number {
  const fights = 3 * (level - 1) + 0.125 * level * (level - 1);
  return Math.max(0, Math.round(2 * (Math.sqrt(36 + fights) - 6)));
}
function levelForCycle(cycle: number): number {
  const fights = 6 * cycle + (cycle * cycle) / 4;
  return Math.max(1, Math.round((-3 + Math.sqrt(9 + 0.5 * fights)) / 0.25));
}

function makeEnemy(level: number, type: FightType, cycle = cycleForLevel(level)): EnemyInstance {
  if (type === 'boss') return pickBoss(cycle, level);
  if (type === 'elite') return pickEnemy(level + 1, true);
  return pickEnemy(level, false);
}

/* -------------------------------------------------------------------- bot -- */

interface FightLog {
  won: boolean;
  rounds: number;
  hpFrac: number;
  energySpent: number;
  abilityUses: number;
  potions: number;
  stalled: boolean;
  threat: string;
}

function choose(c: Combat, s: GameState, braceStreak: number): PlayerAction {
  const hp = c.playerHp;
  const frac = hp / c.playerMaxHp;
  const incoming = c.enemyWillAttack ? c.intentDamage() : 0;
  const potion = Object.keys(s.stats.consumables).find(id => s.consumableCount(id) > 0);
  if (frac < 0.35 && potion) return { type: 'item', id: potion };

  const usable = c.abilities.filter(a => c.canUse(a).ok);
  const heal = usable.find(a => a.healPct);
  if (frac < 0.5 && heal) return { type: 'ability', id: heal.id };

  const enemy = c.enemy;
  const missing = 1 - enemy.hp / Math.max(1, enemy.maxHp);
  const attacks = usable
    .filter(a => a.kind === 'attack' && a.power > 0)
    .map(a => ({ a, score: a.power * (a.hits ?? 1) * (1 + (a.execute ?? 0) * missing) }))
    .sort((x, y) => y.score - x.score);

  if (incoming >= 0.35 * hp) {
    const wall = usable.find(a => a.shieldFromDef || a.shieldFromHp);
    if (wall) return { type: 'ability', id: wall.id };
    // A blow that ends the fight beats a shield.
    const k = COMBAT.mitBase + COMBAT.mitPerLevel * s.stats.level;
    const best = attacks[0];
    const est = best ? s.derived.atk * best.score * (k / (k + enemy.def)) : 0;
    if (best && est >= enemy.hp + enemy.shield) return { type: 'ability', id: best.a.id };
    // Turtling forever is not a plan: after two braces in a row, hit back.
    if (braceStreak < 2) return { type: 'brace' };
  }

  const fury = usable.find(a => a.id === 'ab_battle_fury');
  if (fury && enemy.hp > enemy.maxHp * 0.5) return { type: 'ability', id: fury.id };
  const focus = usable.find(a => a.id === 'ab_focus');
  if (focus && c.energy <= 4) return { type: 'ability', id: focus.id };
  if (attacks[0]) return { type: 'ability', id: attacks[0].a.id };
  return { type: 'basic' };
}

function fight(level: number, type: FightType, P: number, cycle?: number): FightLog {
  const s = makePlayer(level);
  const enemy = makeEnemy(level, type, cycle);
  const c = new Combat(s, enemy);
  const threat = c.threat().label;
  let energySpent = 0;
  let abilityUses = 0;
  let potions = 0;
  let status = c.status;
  let round = 0;
  let braceStreak = 0;
  for (; round < 60; round++) {
    const action = choose(c, s, braceStreak);
    braceStreak = action.type === 'brace' ? braceStreak + 1 : 0;
    if (action.type === 'ability') {
      const ab = c.abilities.find(a => a.id === action.id)!;
      energySpent += c.costOf(ab);
      abilityUses += 1;
    }
    if (action.type === 'item') potions += 1;
    const r = c.act(action);
    status = r.status;
    if (status !== 'awaiting') break;
    const parry: ParryResult = c.enemyWillAttack && Math.random() < P ? 'perfect' : 'none';
    const r2 = c.enemyTurn(parry);
    status = r2.status;
    if (status !== 'ongoing') break;
  }
  return {
    won: status === 'won',
    rounds: c.turns + (status === 'won' ? 1 : 0),
    hpFrac: c.playerHp / c.playerMaxHp,
    energySpent,
    abilityUses,
    potions,
    stalled: round >= 60,
    threat
  };
}

/* ------------------------------------------------------------------ table -- */

function cell(level: number, type: FightType, P: number, cycle?: number) {
  const logs: FightLog[] = [];
  for (let i = 0; i < FIGHTS; i++) logs.push(fight(level, type, P, cycle));
  const wins = logs.filter(l => l.won);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const threats: Record<string, number> = {};
  for (const l of logs) threats[l.threat] = (threats[l.threat] ?? 0) + 1;
  const threatStr = Object.entries(threats)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${Math.round((100 * v) / logs.length)}%`)
    .join(', ');
  return {
    win: wins.length / logs.length,
    rounds: avg(wins.map(l => l.rounds)),
    hp: avg(wins.map(l => l.hpFrac)),
    energy: avg(logs.map(l => l.energySpent)),
    abilities: avg(logs.map(l => l.abilityUses)),
    potions: avg(logs.map(l => l.potions)),
    stalled: logs.filter(l => l.stalled).length / logs.length,
    threats: threatStr
  };
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function profile(level: number) {
  const N = 40;
  const acc = { hp: 0, atk: 0, def: 0, crit: 0, cd: 0, ls: 0 };
  let lo = Infinity, hi = 0;
  for (let i = 0; i < N; i++) {
    const d = makePlayer(level).derived;
    acc.hp += d.maxHp; acc.atk += d.atk; acc.def += d.def; acc.crit += d.critChance; acc.cd += d.critDamage; acc.ls += d.lifesteal;
    lo = Math.min(lo, d.power); hi = Math.max(hi, d.power);
  }
  const f = (n: number) => Math.round(n / N);
  const e = makeEnemy(level, "normal");
  const el = makeEnemy(level, "elite");
  const b = makeEnemy(level, "boss");
  return `L${level}: player hp ${f(acc.hp)} atk ${f(acc.atk)} def ${f(acc.def)} crit ${pct(acc.crit / N)} cd x${(acc.cd / N).toFixed(2)} ls ${pct(acc.ls / N)} power ${lo}-${hi} | normal ${e.name} hp ${e.maxHp} atk ${e.atk} def ${e.def} xp ${e.xpReward} | elite hp ${el.maxHp} atk ${el.atk} def ${el.def} | boss ${b.name} hp ${b.maxHp} atk ${b.atk} def ${b.def}`;
}

function xpTable() {
  console.log('\n## XP curve (normal fights per level, average enemy XP at that level)\n');
  console.log('| level | xp to next | avg fight xp | fights/level | cumulative fights |');
  console.log('|---|---|---|---|---|');
  let cumulative = 0;
  for (let L = 1; L <= 40; L++) {
    let xp = 0;
    for (let i = 0; i < 200; i++) xp += pickEnemy(L, false).xpReward;
    xp /= 200;
    const fights = XP_CURVE(L) / xp;
    cumulative += fights;
    if (L <= 10 || L % 5 === 0) console.log(`| ${L} | ${XP_CURVE(L)} | ${xp.toFixed(0)} | ${fights.toFixed(1)} | ${cumulative.toFixed(0)} |`);
  }
}

function bossTable() {
  console.log(`# Boss scripts — ${FIGHTS} fights each, at the level the road reaches them\n`);
  console.log('| # | boss | level | win P=.35 | rounds | hp left | stall | win P=.7 | rounds | hp left |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (let idx = 0; idx < 20; idx++) {
    const level = levelForCycle(idx);
    const b = pickBoss(idx, level);
    const a = cell(level, 'boss', 0.35, idx);
    const g = cell(level, 'boss', 0.7, idx);
    console.log(`| ${idx} | ${b.name} (${b.title}) | ${level} | ${pct(a.win)} | ${a.rounds.toFixed(1)} | ${pct(a.hp)} | ${pct(a.stalled)} | ${pct(g.win)} | ${g.rounds.toFixed(1)} | ${pct(g.hp)} |`);
  }
}

if (TRACE >= 0) {
  const level = levelForCycle(TRACE);
  const s = makePlayer(level);
  const enemy = pickBoss(TRACE, level);
  const c = new Combat(s, enemy);
  console.log(`${enemy.name} L${level}: boss hp ${enemy.maxHp} atk ${enemy.atk} def ${enemy.def} | player hp ${s.maxHp} atk ${s.derived.atk} def ${s.derived.def} abilities ${c.abilities.map(a => a.id).join(',')}`);
  let streak = 0;
  for (let round = 0; round < 60; round++) {
    const action = choose(c, s, streak);
    streak = action.type === 'brace' ? streak + 1 : 0;
    const r = c.act(action);
    const line1 = r.events.filter(e => e.kind !== 'action').map(e => `${e.kind}${e.amount !== undefined ? ' ' + e.amount : ''}${e.kind === 'status' || e.kind === 'phase' || e.kind === 'info' ? ' ' + e.text : ''}`).join(', ');
    console.log(`R${round + 1} P:${(action as any).id ?? action.type} → [${line1}] php ${c.playerHp} ehp ${c.enemyHp}+${c.enemyShield} en ${c.energy}`);
    if (r.status !== 'awaiting') { console.log('END', r.status); break; }
    const parry: ParryResult = c.enemyWillAttack && Math.random() < 0.35 ? 'perfect' : 'none';
    const r2 = c.enemyTurn(parry);
    const line2 = r2.events.filter(e => e.kind !== 'action').map(e => `${e.kind}${e.amount !== undefined ? ' ' + e.amount : ''}${e.kind === 'status' || e.kind === 'phase' || e.kind === 'info' || e.kind === 'turn' ? ' ' + e.text : ''}`).join(', ');
    console.log(`   E(${parry}) → [${line2}] php ${c.playerHp}+${c.playerShield} ehp ${c.enemyHp}+${c.enemyShield} st ${c.playerStatuses.map(x => x.id + x.stacks).join(' ')} | ${c.enemyStatuses.map(x => x.id + x.stacks).join(' ')}`);
    if (r2.status !== 'ongoing') { console.log('END', r2.status); break; }
  }
  process.exit(0);
}

if (BOSS_MODE) {
  bossTable();
  process.exit(0);
}

console.log(`# Balance sim — ${FIGHTS} fights per cell\n`);
for (const L of LEVELS) console.log(profile(L));

for (const P of PARRIES) {
  console.log(`\n## Parry success P = ${P}\n`);
  console.log('| level | type | win | rounds | hp left | energy | skills | potions | stall | threat read |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const L of LEVELS) {
    for (const type of TYPES) {
      const r = cell(L, type, P);
      console.log(
        `| ${L} | ${type} | ${pct(r.win)} | ${r.rounds.toFixed(1)} | ${pct(r.hp)} | ${r.energy.toFixed(1)} | ${r.abilities.toFixed(1)} | ${r.potions.toFixed(2)} | ${pct(r.stalled)} | ${r.threats} |`
      );
    }
  }
}
if (SHOW_XP) xpTable();

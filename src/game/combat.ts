/* ============================================================================
 * Turn-based combat engine.
 *
 * A round is: player action -> enemy damage-over-time -> enemy action (the one
 * it telegraphed) -> player damage-over-time -> upkeep -> next telegraph.
 * Everything the screen needs to animate comes back as an ordered event list.
 * ========================================================================== */

import type { EnemyInstance, Intent, StatusEffect, StatusId } from './types';
import type { GameState } from './state';
import { COMBAT } from './config';
import {
  ABILITIES,
  STATUS_INFO,
  abilityById,
  supportAbilityId,
  weaponAbilityId,
  type CombatAbility,
  type StatusApplication
} from './data/abilities';
import { ARCHETYPE_MOVES, archetypeFor, type EnemyMove } from './data/enemies';
import { bossScript, PASSIVE_INFO, type BossPassive, type BossPhase } from './data/bosses';

export type Side = 'player' | 'enemy';

export type CombatEventKind =
  | 'action'
  | 'damage'
  | 'crit'
  | 'block'
  | 'heal'
  | 'shield'
  | 'status'
  | 'dot'
  | 'info'
  | 'phase'
  | 'revive'
  | 'flee'
  | 'death';

export interface CombatEvent {
  kind: CombatEventKind;
  /** Who the event lands on. */
  target: Side;
  /** Who caused it, when that differs. */
  source?: Side;
  amount?: number;
  text: string;
  label?: string;
  icon?: string;
  fx?: string;
  /** Suggested dwell time in seconds for the screen's beat player. */
  hold?: number;
}

export type CombatStatusOutcome = 'ongoing' | 'won' | 'lost' | 'fled';

export interface TurnResult {
  events: CombatEvent[];
  status: CombatStatusOutcome;
  playerHp: number;
  enemyHp: number;
  turns: number;
}

export interface CombatStatus extends StatusEffect {
  /** Per-stack magnitude for damage/heal statuses. */
  potency: number;
}

export type PlayerAction =
  | { type: 'basic' }
  | { type: 'ability'; id: string }
  | { type: 'brace' }
  | { type: 'item'; id: string }
  | { type: 'flee' }
  | { type: 'pass' };

export interface ConsumableEffect {
  name: string;
  icon: string;
  healPct?: number;
  heal?: number;
  energy?: number;
  cleanse?: boolean;
  status?: StatusApplication;
  description: string;
}

/**
 * Local consumable table. The shop/items workstream owns which ids exist, so
 * unknown ids fall back to a generic potion rather than throwing.
 */
export const CONSUMABLE_EFFECTS: Record<string, ConsumableEffect> = {
  potion_small: { name: 'Small Potion', icon: '🧪', healPct: 0.3, description: 'Restores 30% HP.' },
  potion_medium: { name: 'Potion', icon: '⚗️', healPct: 0.5, description: 'Restores 50% HP.' },
  potion_large: { name: 'Large Potion', icon: '🍶', healPct: 0.8, description: 'Restores 80% HP.' },
  potion_full: { name: 'Elixir', icon: '🏺', healPct: 1, cleanse: true, description: 'Full heal, clears effects.' },
  antidote: { name: 'Antidote', icon: '🧿', cleanse: true, healPct: 0.1, description: 'Clears all harmful effects.' },
  elixir_power: {
    name: 'Rage Elixir',
    icon: '🧨',
    status: { status: 'enrage', stacks: 3, turns: 3, chance: 1, onSelf: true },
    description: 'Enrage (3) for 3 turns.'
  },
  elixir_stone: {
    name: 'Stoneskin Draught',
    icon: '🪨',
    status: { status: 'fortify', stacks: 3, turns: 3, chance: 1, onSelf: true },
    description: 'Fortify (3) for 3 turns.'
  },
  bomb: { name: 'Firebomb', icon: '💣', description: 'Burns the enemy.' },
  ether: { name: 'Ether', icon: '🔷', energy: 6, description: 'Restores 6 energy.' }
};

export function consumableEffect(id: string): ConsumableEffect {
  return (
    CONSUMABLE_EFFECTS[id] ?? {
      name: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      icon: '🧪',
      healPct: 0.3,
      description: 'Restores 30% HP.'
    }
  );
}

/* ------------------------------------------------------------------ maths -- */

function variance(): number {
  return 0.9 + Math.random() * 0.2;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

const MAX_STACKS = 12;

/** Per-stack, per-turn magnitude of the damage/heal statuses. */
function statusPotency(id: StatusId, sourceAtk: number, sourceMaxHp: number): number {
  switch (id) {
    case 'poison':
      return Math.max(1, Math.round(sourceAtk * 0.09));
    case 'burn':
      return Math.max(1, Math.round(sourceAtk * 0.16));
    case 'bleed':
      return Math.max(1, Math.round(sourceAtk * 0.12));
    case 'regen':
      return Math.max(1, Math.round(sourceMaxHp * 0.028));
    default:
      return 0;
  }
}

export function isHarmful(id: StatusId): boolean {
  return STATUS_INFO[id].harmful;
}

/* ------------------------------------------------------------ the fighters -- */

interface Fighter {
  side: Side;
  statuses: CombatStatus[];
  shield: number;
}

export interface ThreatRating {
  label: string;
  level: 0 | 1 | 2 | 3 | 4;
  /** Estimated rounds for the player to win. */
  turnsToKill: number;
  /** Estimated rounds for the enemy to win. */
  turnsToDie: number;
}

/* ------------------------------------------------------------------ engine -- */

export class Combat {
  readonly enemy: EnemyInstance;
  readonly player: GameState;
  readonly isBoss: boolean;

  energy = COMBAT.startEnergy;
  turns = 0;
  status: CombatStatusOutcome = 'ongoing';
  intent: Intent;

  /** Skills available this fight, resolved from equipped gear. */
  abilities: CombatAbility[] = [];
  cooldowns: Record<string, number> = {};

  playerStatuses: CombatStatus[] = [];
  playerShield = 0;

  /** Boss state. */
  phases: BossPhase[] = [];
  phaseIndex = 0;
  passive: BossPassive | null = null;
  private revived = false;
  private rewound = false;
  private enemyAtkMult = 1;
  private echoCounter = 0;

  private moveCooldowns: Record<string, number> = {};
  private pendingPayoff: EnemyMove | null = null;
  private currentMove: EnemyMove;
  private lastMoveId = '';
  private enemyBaseAtk: number;

  constructor(player: GameState, enemy: EnemyInstance) {
    this.player = player;
    this.enemy = enemy;
    this.isBoss = enemy.isBoss;
    this.enemyBaseAtk = enemy.atk;
    enemy.statuses = enemy.statuses ?? [];
    enemy.shield = 0;

    if (enemy.isBoss) {
      const script = bossScript(enemy.id);
      this.phases = script.phases;
      this.passive = script.passive ?? null;
    }

    this.abilities = resolveAbilities(player);
    this.currentMove = this.chooseMove(true);
    this.intent = this.intentFor(this.currentMove);
  }

  /* ------------------------------------------------------------- readouts -- */

  get playerHp() {
    return this.player.stats.hp;
  }
  get playerMaxHp() {
    return this.player.maxHp;
  }
  get enemyHp() {
    return this.enemy.hp;
  }
  get enemyStatuses(): CombatStatus[] {
    return this.enemy.statuses as CombatStatus[];
  }
  get enemyShield() {
    return this.enemy.shield;
  }
  get phaseName(): string {
    return this.phases[this.phaseIndex]?.name ?? '';
  }
  get passiveInfo() {
    return this.passive ? PASSIVE_INFO[this.passive] : null;
  }

  /** Effective attack after enrage/weaken. */
  private atkOf(side: Side): number {
    const base = side === 'player' ? this.player.derived.atk : this.enemy.atk * this.enemyAtkMult;
    const st = side === 'player' ? this.playerStatuses : this.enemyStatuses;
    const enrage = stackOf(st, 'enrage');
    const weaken = stackOf(st, 'weaken');
    return Math.max(1, base * (1 + enrage * 0.25) * Math.max(0.25, 1 - weaken * 0.15));
  }

  /** Effective defense after fortify. */
  private defOf(side: Side): number {
    const base = side === 'player' ? this.player.derived.def : this.enemy.def;
    const st = side === 'player' ? this.playerStatuses : this.enemyStatuses;
    return base * (1 + stackOf(st, 'fortify') * 0.25);
  }

  private get mitK(): number {
    return 45 + 12 * this.player.stats.level;
  }

  private mitigate(raw: number, def: number, pierce = 0): number {
    const eff = Math.max(0, def * (1 - clamp(pierce, 0, 1)));
    return Math.max(1, Math.round(raw * (this.mitK / (this.mitK + eff))));
  }

  /** Damage the telegraphed intent would do right now, for the UI. */
  intentDamage(): number {
    const m = this.pendingPayoff ?? this.currentMove;
    if (!m || m.power <= 0) return 0;
    const raw = this.atkOf('enemy') * m.power;
    const per = this.mitigate(raw, this.defOf('player'), m.pierce ?? 0);
    return per * (m.hits ?? 1);
  }

  /** A visible, honest difficulty read for the player. */
  threat(): ThreatRating {
    const myDps = this.mitigate(this.atkOf('player') * 1.25, this.defOf('enemy'));
    const theirDps = Math.max(1, this.intentDamage() || this.mitigate(this.atkOf('enemy'), this.defOf('player')));
    const ttk = Math.max(1, Math.ceil(this.enemy.hp / Math.max(1, myDps)));
    const ttd = Math.max(1, Math.ceil(this.playerHp / theirDps));
    const ratio = ttk / ttd;
    let level: ThreatRating['level'] = 2;
    if (ratio <= 0.4) level = 0;
    else if (ratio <= 0.7) level = 1;
    else if (ratio <= 1.05) level = 2;
    else if (ratio <= 1.6) level = 3;
    else level = 4;
    const label = ['Trivial', 'Favourable', 'Even', 'Dangerous', 'Deadly'][level];
    return { label, level, turnsToKill: ttk, turnsToDie: ttd };
  }

  canUse(ability: CombatAbility): { ok: boolean; reason: string } {
    if ((this.cooldowns[ability.id] ?? 0) > 0)
      return { ok: false, reason: `${this.cooldowns[ability.id]}` };
    if (this.energy < ability.cost) return { ok: false, reason: 'Energy' };
    return { ok: true, reason: '' };
  }

  get playerStunned(): boolean {
    return stackOf(this.playerStatuses, 'stun') > 0;
  }

  /* ---------------------------------------------------------------- round -- */

  act(action: PlayerAction): TurnResult {
    if (this.status !== 'ongoing') return this.result([], this.status);
    const ev: CombatEvent[] = [];

    // --- player half of the round -------------------------------------
    if (this.playerStunned && action.type !== 'flee') {
      this.removeStatus(this.playerStatuses, 'stun');
      ev.push({ kind: 'info', target: 'player', text: 'Stunned — you lose your turn!', icon: '💫', hold: 0.5 });
    } else {
      switch (action.type) {
        case 'basic':
          this.doBasic(ev);
          break;
        case 'ability':
          this.doAbility(ev, action.id);
          break;
        case 'brace':
          this.doBrace(ev);
          break;
        case 'item':
          this.doItem(ev, action.id);
          break;
        case 'flee': {
          const done = this.doFlee(ev);
          if (done) return this.result(ev, 'fled');
          break;
        }
        case 'pass':
          ev.push({ kind: 'info', target: 'player', text: 'You wait.', icon: '⏳', hold: 0.3 });
          this.energy = Math.min(COMBAT.maxEnergy, this.energy + 2);
          break;
      }
    }

    if (this.enemy.hp <= 0 && !this.tryRevive(ev)) return this.finishWin(ev);

    // --- enemy damage-over-time ---------------------------------------
    this.tickStatuses(ev, 'enemy');
    if (this.enemy.hp <= 0 && !this.tryRevive(ev)) return this.finishWin(ev);
    this.checkPhase(ev);

    // --- enemy half of the round --------------------------------------
    this.enemyTurn(ev);
    if (this.player.isDead()) return this.finishLoss(ev);

    // --- player damage-over-time --------------------------------------
    this.tickStatuses(ev, 'player');
    if (this.player.isDead()) return this.finishLoss(ev);
    if (this.enemy.hp <= 0 && !this.tryRevive(ev)) return this.finishWin(ev);

    // --- upkeep --------------------------------------------------------
    this.turns += 1;
    this.energy = Math.min(COMBAT.maxEnergy, this.energy + COMBAT.energyPerTurn);
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - 1);
    for (const k of Object.keys(this.moveCooldowns))
      this.moveCooldowns[k] = Math.max(0, this.moveCooldowns[k] - 1);
    if (this.passive === 'relentless') {
      this.enemyAtkMult *= 1.07;
    }
    this.currentMove = this.pendingPayoff ?? this.chooseMove(false);
    this.intent = this.intentFor(this.currentMove);

    return this.result(ev, 'ongoing');
  }

  /* --------------------------------------------------------- player moves -- */

  private doBasic(ev: CombatEvent[]) {
    ev.push({ kind: 'action', target: 'enemy', source: 'player', text: 'Strike', label: 'Strike', icon: '⚔️', fx: 'slash' });
    this.strike(ev, 1, {});
    this.energy = Math.min(COMBAT.maxEnergy, this.energy + COMBAT.energyPerBasic);
  }

  private doAbility(ev: CombatEvent[], id: string) {
    const ab = this.abilities.find(a => a.id === id) ?? abilityById(id);
    if (!ab) return this.doBasic(ev);
    const check = this.canUse(ab);
    if (!check.ok) {
      ev.push({ kind: 'info', target: 'player', text: 'Not ready.', hold: 0.2 });
      return;
    }
    this.energy -= ab.cost;
    if (ab.cooldown > 0) this.cooldowns[ab.id] = ab.cooldown + 1;
    if (ab.energyGain) this.energy = Math.min(COMBAT.maxEnergy, this.energy + ab.energyGain);

    ev.push({
      kind: 'action',
      target: ab.kind === 'attack' ? 'enemy' : 'player',
      source: 'player',
      text: ab.name,
      label: ab.name,
      icon: ab.icon,
      fx: ab.fx ?? 'arcane'
    });

    if (ab.cleanse) {
      const removed = this.playerStatuses.filter(s => isHarmful(s.id)).length;
      this.playerStatuses = this.playerStatuses.filter(s => !isHarmful(s.id));
      if (removed > 0)
        ev.push({ kind: 'status', target: 'player', text: 'Cleansed!', icon: '✨', hold: 0.35 });
    }
    if (ab.healPct) {
      const amount = Math.round(this.playerMaxHp * ab.healPct);
      this.healPlayer(ev, amount);
    }
    if (ab.shieldFromDef || ab.shieldFromHp) {
      const amount = Math.round(
        this.defOf('player') * (ab.shieldFromDef ?? 0) + this.playerMaxHp * (ab.shieldFromHp ?? 0)
      );
      this.playerShield += amount;
      ev.push({ kind: 'shield', target: 'player', amount, text: `+${amount} shield`, icon: '🛡️', hold: 0.35 });
    }
    if (ab.power > 0) {
      const hits = ab.hits ?? 1;
      for (let i = 0; i < hits; i++) {
        if (this.enemy.hp <= 0) break;
        this.strike(ev, ab.power, {
          pierce: ab.pierce,
          execute: ab.execute,
          drain: ab.drain,
          critBonus: ab.critBonus,
          fx: ab.fx,
          multi: hits > 1
        });
      }
    }
    if (ab.applies) this.applyFromPlayer(ev, ab.applies);
    if (ab.applies2) this.applyFromPlayer(ev, ab.applies2);
  }

  private applyFromPlayer(ev: CombatEvent[], app: StatusApplication) {
    if (Math.random() > app.chance) return;
    const onSelf = !!app.onSelf;
    const target: Side = onSelf ? 'player' : 'enemy';
    if (!onSelf && this.enemy.hp <= 0) return;
    this.addStatus(
      onSelf ? this.playerStatuses : this.enemyStatuses,
      app,
      statusPotency(app.status, this.atkOf('player'), this.playerMaxHp)
    );
    ev.push({
      kind: 'status',
      target,
      text: `${STATUS_INFO[app.status].name} ${app.stacks > 1 ? `x${app.stacks}` : ''}`.trim(),
      icon: STATUS_INFO[app.status].icon,
      hold: 0.32
    });
  }

  private doBrace(ev: CombatEvent[]) {
    const amount = Math.round(this.defOf('player') * 1.4 + this.playerMaxHp * 0.08);
    this.playerShield += amount;
    this.addStatus(this.playerStatuses, { status: 'fortify', stacks: 1, turns: 2, chance: 1 }, 0);
    this.energy = Math.min(COMBAT.maxEnergy, this.energy + 2);
    ev.push({
      kind: 'action',
      target: 'player',
      source: 'player',
      text: 'Brace',
      label: 'Brace',
      icon: '🛡️',
      fx: 'guard'
    });
    ev.push({ kind: 'shield', target: 'player', amount, text: `+${amount} shield`, icon: '🛡️', hold: 0.4 });
    this.braced = true;
  }

  /** Set on brace, consumed by the enemy's next hit. */
  private braced = false;

  private doItem(ev: CombatEvent[], id: string) {
    if (!this.player.useConsumable(id)) {
      ev.push({ kind: 'info', target: 'player', text: 'None left.', hold: 0.2 });
      return;
    }
    const eff = consumableEffect(id);
    ev.push({
      kind: 'action',
      target: 'player',
      source: 'player',
      text: eff.name,
      label: eff.name,
      icon: eff.icon,
      fx: 'heal'
    });
    if (eff.cleanse) {
      this.playerStatuses = this.playerStatuses.filter(s => !isHarmful(s.id));
      ev.push({ kind: 'status', target: 'player', text: 'Cleansed!', icon: '✨', hold: 0.3 });
    }
    if (eff.healPct || eff.heal) {
      const amount = Math.round((eff.heal ?? 0) + this.playerMaxHp * (eff.healPct ?? 0));
      this.healPlayer(ev, amount);
    }
    if (eff.energy) {
      this.energy = Math.min(COMBAT.maxEnergy, this.energy + eff.energy);
      ev.push({ kind: 'info', target: 'player', text: `+${eff.energy} energy`, icon: '⚡', hold: 0.3 });
    }
    if (eff.status) this.applyFromPlayer(ev, eff.status);
    if (id === 'bomb') {
      this.strike(ev, 1.4, { pierce: 1, fx: 'fire' });
      this.applyFromPlayer(ev, { status: 'burn', stacks: 3, turns: 3, chance: 1 });
    }
  }

  private doFlee(ev: CombatEvent[]): boolean {
    if (this.isBoss) {
      ev.push({ kind: 'info', target: 'player', text: 'There is no running from this.', icon: '🚫', hold: 0.5 });
      return false;
    }
    const chance = COMBAT.fleeChance - (this.enemy.isElite ? 0.2 : 0);
    if (Math.random() < chance) {
      this.status = 'fled';
      ev.push({ kind: 'flee', target: 'player', text: 'You break away!', icon: '💨', hold: 0.6 });
      return true;
    }
    ev.push({ kind: 'info', target: 'player', text: 'Escape failed!', icon: '💢', hold: 0.45 });
    // A failed escape costs you: the enemy gets a free swing.
    const raw = this.atkOf('enemy') * 1.1 * variance();
    const dmg = this.mitigate(raw, this.defOf('player'));
    this.damagePlayer(ev, dmg, false);
    return false;
  }

  /* ------------------------------------------------------- damage plumbing -- */

  private strike(
    ev: CombatEvent[],
    power: number,
    o: { pierce?: number; execute?: number; drain?: number; critBonus?: number; fx?: string; multi?: boolean }
  ) {
    const d = this.player.derived;
    let raw = this.atkOf('player') * power * variance();
    if (o.execute) {
      const missing = 1 - this.enemy.hp / Math.max(1, this.enemy.maxHp);
      raw *= 1 + o.execute * missing;
    }
    const crit = Math.random() < clamp(d.critChance + (o.critBonus ?? 0), 0, 0.95);
    let dmg = this.mitigate(raw, this.defOf('enemy'), o.pierce ?? 0);
    if (crit) dmg = Math.round(dmg * d.critDamage);

    const absorbed = Math.min(this.enemy.shield, dmg);
    this.enemy.shield -= absorbed;
    const through = dmg - absorbed;
    this.enemy.hp = Math.max(0, this.enemy.hp - through);

    if (absorbed > 0 && through === 0) {
      ev.push({ kind: 'block', target: 'enemy', amount: absorbed, text: `${absorbed} blocked`, icon: '🛡️', hold: 0.28 });
    } else {
      ev.push({
        kind: crit ? 'crit' : 'damage',
        target: 'enemy',
        source: 'player',
        amount: dmg,
        text: crit ? `CRIT ${dmg}` : `${dmg}`,
        fx: o.fx,
        hold: o.multi ? 0.2 : 0.3
      });
    }

    if (this.passive === 'adaptive' && crit) {
      this.addStatus(this.enemyStatuses, { status: 'fortify', stacks: 1, turns: 3, chance: 1 }, 0);
      ev.push({ kind: 'status', target: 'enemy', text: 'Adapts!', icon: '🧱', hold: 0.28 });
    }

    const heal = Math.round(dmg * (d.lifesteal + (o.drain ?? 0)));
    if (heal > 0 && this.playerHp < this.playerMaxHp) this.healPlayer(ev, heal);

    // Reflect: elite ability + the thorns passive.
    const reflectPct = (this.enemy.ability === 'reflect' ? 0.2 : 0) + (this.passive === 'thorns' ? 0.25 : 0);
    if (reflectPct > 0 && dmg > 0) {
      const back = Math.max(1, Math.round(dmg * reflectPct));
      ev.push({ kind: 'info', target: 'player', text: 'Reflected!', icon: '🌵', hold: 0.25 });
      this.damagePlayer(ev, back, false);
    }
  }

  private healPlayer(ev: CombatEvent[], amount: number) {
    const before = this.playerHp;
    this.player.heal(amount);
    const gained = this.playerHp - before;
    if (gained > 0) {
      ev.push({ kind: 'heal', target: 'player', amount: gained, text: `+${gained}`, icon: '💚', hold: 0.3 });
      if (this.passive === 'devour') {
        this.addStatus(this.enemyStatuses, { status: 'enrage', stacks: 1, turns: 99, chance: 1 }, 0);
        ev.push({ kind: 'status', target: 'enemy', text: 'It feeds on your relief.', icon: '🍽️', hold: 0.3 });
      }
    }
  }

  private damagePlayer(ev: CombatEvent[], amount: number, fromIntent: boolean, fx?: string) {
    let dmg = Math.max(1, Math.round(amount));
    if (fromIntent && this.braced) {
      dmg = Math.max(1, Math.round(dmg * (1 - COMBAT.defendReduction)));
    }
    const absorbed = Math.min(this.playerShield, dmg);
    this.playerShield -= absorbed;
    const through = dmg - absorbed;
    this.player.takeDamage(through);
    if (absorbed > 0 && through === 0) {
      ev.push({ kind: 'block', target: 'player', amount: absorbed, text: `${absorbed} blocked`, icon: '🛡️', hold: 0.3 });
    } else {
      ev.push({
        kind: 'damage',
        target: 'player',
        source: 'enemy',
        amount: dmg,
        text: `${dmg}`,
        fx,
        hold: 0.3
      });
    }
    return dmg;
  }

  /* ---------------------------------------------------------- enemy brain -- */

  private movePool(): EnemyMove[] {
    if (this.isBoss) {
      const phase = this.phases[this.phaseIndex];
      if (phase) return phase.moves;
    }
    return ARCHETYPE_MOVES[archetypeFor(this.enemy.id)] ?? ARCHETYPE_MOVES.brute;
  }

  private chooseMove(opener: boolean): EnemyMove {
    const frac = this.enemy.hp / Math.max(1, this.enemy.maxHp);
    const pool = this.movePool().filter(m => {
      if ((this.moveCooldowns[m.id] ?? 0) > 0) return false;
      if (opener && m.notOpener) return false;
      if (m.aboveHp !== undefined && frac < m.aboveHp) return false;
      if (m.belowHp !== undefined && frac > m.belowHp) return false;
      if (m.healPct && this.enemy.hp >= this.enemy.maxHp * 0.95) return false;
      return true;
    });
    const usable = pool.length > 0 ? pool : this.movePool().slice(0, 1);
    // Slight bias away from repeating the same move twice.
    const total = usable.reduce((s, m) => s + m.weight * (m.id === this.lastMoveId ? 0.35 : 1), 0);
    let roll = Math.random() * total;
    for (const m of usable) {
      const w = m.weight * (m.id === this.lastMoveId ? 0.35 : 1);
      if (roll < w) return m;
      roll -= w;
    }
    return usable[usable.length - 1];
  }

  private intentFor(m: EnemyMove): Intent {
    const value = m.power > 0 ? this.intentDamageFor(m) : undefined;
    return { kind: m.kind, label: m.label, icon: m.icon, value };
  }

  private intentDamageFor(m: EnemyMove): number {
    const raw = this.atkOf('enemy') * m.power;
    return this.mitigate(raw, this.defOf('player'), m.pierce ?? 0) * (m.hits ?? 1);
  }

  private enemyTurn(ev: CombatEvent[]) {
    if (stackOf(this.enemyStatuses, 'stun') > 0) {
      this.removeStatus(this.enemyStatuses, 'stun');
      ev.push({ kind: 'info', target: 'enemy', text: `${this.enemy.name} is stunned!`, icon: '💫', hold: 0.5 });
      this.braced = false;
      return;
    }

    const m = this.currentMove;
    this.lastMoveId = m.id;
    if (m.cooldown) this.moveCooldowns[m.id] = m.cooldown + 1;

    ev.push({
      kind: 'action',
      target: m.power > 0 ? 'player' : 'enemy',
      source: 'enemy',
      text: m.label,
      label: m.label,
      icon: m.icon,
      fx: m.kind === 'heavy' || m.kind === 'special' ? 'heavy' : 'slash'
    });

    if (m.payoff) {
      // Wind-up: nothing happens now, but the payoff is locked in for next turn.
      this.pendingPayoff = { ...(m.payoff as EnemyMove), id: `${m.id}_p`, weight: 0 };
      ev.push({
        kind: 'info',
        target: 'enemy',
        text: `${m.payoff.label} incoming!`,
        icon: m.payoff.icon,
        hold: 0.6
      });
      this.braced = false;
      return;
    }
    this.pendingPayoff = null;

    this.resolveEnemyMove(ev, m, 1);

    if (this.passive === 'echo') {
      this.echoCounter += 1;
      if (this.echoCounter % 3 === 0 && m.power > 0 && !this.player.isDead()) {
        ev.push({ kind: 'info', target: 'enemy', text: 'Echo!', icon: '🔁', hold: 0.35 });
        this.resolveEnemyMove(ev, m, 0.6);
      }
    }
    this.braced = false;
  }

  private resolveEnemyMove(ev: CombatEvent[], m: EnemyMove, scale: number) {
    const critChance = this.isBoss ? 0.12 : 0.08;
    if (m.healPct) {
      const amount = Math.round(this.enemy.maxHp * m.healPct * scale);
      this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + amount);
      ev.push({ kind: 'heal', target: 'enemy', amount, text: `+${amount}`, icon: '💚', hold: 0.35 });
    }
    if (m.shieldFromAtk) {
      const amount = Math.round(this.atkOf('enemy') * m.shieldFromAtk * scale);
      this.enemy.shield += amount;
      ev.push({ kind: 'shield', target: 'enemy', amount, text: `+${amount} shield`, icon: '🛡️', hold: 0.35 });
    }
    if (m.power > 0) {
      const hits = m.hits ?? 1;
      let dealt = 0;
      for (let i = 0; i < hits; i++) {
        if (this.player.isDead()) break;
        const crit = Math.random() < critChance;
        let raw = this.atkOf('enemy') * m.power * scale * variance();
        if (crit) raw *= 1.6;
        const dmg = this.mitigate(raw, this.defOf('player'), m.pierce ?? 0);
        dealt += this.damagePlayer(ev, dmg, true, m.kind === 'heavy' || m.kind === 'special' ? 'heavy' : 'slash');
      }
      const drain = (m.drain ?? 0) + (this.enemy.ability === 'lifesteal' ? 0.3 : 0) + (this.passive === 'siphon' ? 0.25 : 0);
      if (drain > 0 && dealt > 0) {
        const heal = Math.max(1, Math.round(dealt * drain));
        this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + heal);
        ev.push({ kind: 'heal', target: 'enemy', amount: heal, text: `+${heal}`, icon: '🧛', hold: 0.3 });
      }
      if (this.passive === 'hoarfrost' && !this.player.isDead()) {
        this.applyFromEnemy(ev, { status: 'weaken', stacks: 1, turns: 2, chance: 1 });
      }
    }
    if (m.applies) this.applyFromEnemy(ev, m.applies);
    if (m.applies2) this.applyFromEnemy(ev, m.applies2);
  }

  private applyFromEnemy(ev: CombatEvent[], app: StatusApplication) {
    if (Math.random() > app.chance) return;
    const onSelf = !!app.onSelf;
    const target: Side = onSelf ? 'enemy' : 'player';
    if (!onSelf && this.player.isDead()) return;
    this.addStatus(
      onSelf ? this.enemyStatuses : this.playerStatuses,
      app,
      statusPotency(app.status, this.atkOf('enemy'), this.enemy.maxHp)
    );
    ev.push({
      kind: 'status',
      target,
      text: `${STATUS_INFO[app.status].name} ${app.stacks > 1 ? `x${app.stacks}` : ''}`.trim(),
      icon: STATUS_INFO[app.status].icon,
      hold: 0.32
    });
  }

  /* --------------------------------------------------------------- phases -- */

  private checkPhase(ev: CombatEvent[]) {
    if (!this.isBoss || this.enemy.hp <= 0) return;
    const frac = this.enemy.hp / Math.max(1, this.enemy.maxHp);
    while (this.phaseIndex + 1 < this.phases.length && frac <= this.phases[this.phaseIndex + 1].at) {
      this.phaseIndex += 1;
      const phase = this.phases[this.phaseIndex];
      ev.push({
        kind: 'phase',
        target: 'enemy',
        text: phase.banner,
        label: phase.name,
        icon: '⚡',
        hold: 1.5
      });
      const e = phase.onEnter;
      if (e) {
        if (e.healPct) {
          const amount = Math.round(this.enemy.maxHp * e.healPct);
          this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + amount);
          ev.push({ kind: 'heal', target: 'enemy', amount, text: `+${amount}`, icon: '💚', hold: 0.4 });
        }
        if (e.shieldFromAtk) {
          const amount = Math.round(this.atkOf('enemy') * e.shieldFromAtk);
          this.enemy.shield += amount;
          ev.push({ kind: 'shield', target: 'enemy', amount, text: `+${amount} shield`, icon: '🛡️', hold: 0.4 });
        }
        if (e.atkMult) this.enemyAtkMult *= e.atkMult;
        if (e.status) this.applyFromEnemy(ev, e.status);
        if (e.stripPlayerBuffs || this.passive === 'nullify') {
          const had = this.playerStatuses.some(s => !isHarmful(s.id));
          this.playerStatuses = this.playerStatuses.filter(s => isHarmful(s.id));
          this.playerShield = 0;
          if (had) ev.push({ kind: 'status', target: 'player', text: 'Your blessings are stripped!', icon: '🚫', hold: 0.5 });
        }
      }
      // A new phase always retelegraphs.
      this.pendingPayoff = null;
      this.moveCooldowns = {};
    }
  }

  private tryRevive(ev: CombatEvent[]): boolean {
    if (this.passive === 'undying' && !this.revived) {
      this.revived = true;
      this.enemy.hp = Math.round(this.enemy.maxHp * 0.35);
      ev.push({
        kind: 'revive',
        target: 'enemy',
        text: `${this.enemy.name} rises again!`,
        icon: '⚰️',
        hold: 1.4
      });
      this.checkPhase(ev);
      return true;
    }
    return false;
  }

  /* -------------------------------------------------------------- statuses -- */

  private addStatus(list: CombatStatus[], app: StatusApplication, potency: number) {
    const existing = list.find(s => s.id === app.status);
    if (existing) {
      existing.stacks = Math.min(MAX_STACKS, existing.stacks + app.stacks);
      existing.turns = Math.max(existing.turns, app.turns);
      existing.potency = Math.max(existing.potency, potency);
    } else {
      list.push({ id: app.status, stacks: Math.min(MAX_STACKS, app.stacks), turns: app.turns, potency });
    }
  }

  private removeStatus(list: CombatStatus[], id: StatusId) {
    const i = list.findIndex(s => s.id === id);
    if (i >= 0) list.splice(i, 1);
  }

  private tickStatuses(ev: CombatEvent[], side: Side) {
    const list = side === 'player' ? this.playerStatuses : this.enemyStatuses;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (s.id === 'poison' || s.id === 'burn' || s.id === 'bleed') {
        const dmg = Math.max(1, s.potency * s.stacks);
        if (side === 'player') {
          this.player.takeDamage(dmg);
        } else {
          this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
        }
        ev.push({
          kind: 'dot',
          target: side,
          amount: dmg,
          text: `${dmg}`,
          icon: STATUS_INFO[s.id].icon,
          fx: s.id,
          hold: 0.3
        });
      } else if (s.id === 'regen') {
        const amount = Math.max(1, s.potency * s.stacks);
        if (side === 'player') this.healPlayer(ev, amount);
        else {
          this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + amount);
          ev.push({ kind: 'heal', target: 'enemy', amount, text: `+${amount}`, icon: '💚', hold: 0.28 });
        }
      }
      if (s.id !== 'stun') {
        s.turns -= 1;
        if (s.turns <= 0) list.splice(i, 1);
      }
    }
    // Shields decay so defence has to be re-earned.
    if (side === 'player') this.playerShield = Math.round(this.playerShield * 0.6);
    else this.enemy.shield = Math.round(this.enemy.shield * 0.6);
  }

  /* ---------------------------------------------------------------- finish -- */

  private finishWin(ev: CombatEvent[]): TurnResult {
    this.status = 'won';
    ev.push({ kind: 'death', target: 'enemy', text: `${this.enemy.name} falls!`, icon: '💀', hold: 0.9 });
    return this.result(ev, 'won');
  }

  private finishLoss(ev: CombatEvent[]): TurnResult {
    this.status = 'lost';
    ev.push({ kind: 'death', target: 'player', text: 'You fall...', icon: '💀', hold: 0.9 });
    return this.result(ev, 'lost');
  }

  private result(events: CombatEvent[], status: CombatStatusOutcome): TurnResult {
    this.status = status;
    return { events, status, playerHp: this.playerHp, enemyHp: this.enemy.hp, turns: this.turns };
  }
}

/* -------------------------------------------------------------- utilities -- */

export function stackOf(list: StatusEffect[], id: StatusId): number {
  const s = list.find(x => x.id === id);
  return s ? s.stacks : 0;
}

/**
 * Resolves the player's skill bar from equipped gear. Weapons grant an offensive
 * skill, offhand/armor/trinket may grant a support skill. Always returns at
 * least the innate kit so the bar is never empty.
 */
export function resolveAbilities(player: GameState): CombatAbility[] {
  const eq = player.equipment;
  const out: CombatAbility[] = [];
  const push = (id: string | null | undefined) => {
    const ab = abilityById(id);
    if (ab && !out.some(a => a.id === ab.id)) out.push(ab);
  };

  const weapon = eq.weapon;
  push(weapon?.abilityId ?? weaponAbilityId(weapon?.baseId ?? null));

  for (const slot of ['offhand', 'trinket', 'armor', 'helm', 'boots'] as const) {
    const item = eq[slot];
    if (!item) continue;
    push(item.abilityId ?? supportAbilityId(item.baseId));
    if (out.length >= 3) break;
  }

  push('ab_power_strike');
  push('ab_second_wind');

  return out.slice(0, 4);
}

export const ALL_ABILITIES = ABILITIES;

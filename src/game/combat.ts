/* ============================================================================
 * Turn-based combat engine — two-phase rounds.
 *
 * A round is split in two calls so the screen can animate the player's blow,
 * then ask the player to time a parry before the enemy's move lands:
 *
 *   act(action)        player half   → returns 'awaiting' (or a terminal status)
 *   enemyTurn(parry)   enemy half    → returns 'ongoing'  (or a terminal status)
 *
 * RESOLUTION ORDER (this is the contract; the death-order bugs lived here)
 * ----------------------------------------------------------------------------
 * act():
 *   1. Misuse guard: anything but 'ongoing' returns an empty result.
 *   2. Player stun check (a stunned player loses the action; flee is still allowed).
 *   3. Player action. Inside a strike:
 *        damage → shield/HP → lifesteal → reflect/thorns ONLY IF THE ENEMY IS
 *        STILL ALIVE (a killing blow is never reflected) → on-hit statuses.
 *      Multi-hit moves stop as soon as either side is at 0.
 *      Flee resolves completely here: success → 'fled'; failure → one free enemy
 *      swing (can kill the player → 'lost'), then the round continues.
 *   4. Enemy death check (undying revive may cancel it) → 'won'.
 *   5. Player death check (reflect / self-inflicted, enemy alive) → 'lost'.
 *   6. Enemy damage-over-time tick → enemy death check → 'won'.
 *   7. Boss checks: rewind passive, phase transitions (may heal/shield/strip).
 *   8. status = 'awaiting'; the result carries `incoming` (attack? + intent).
 *
 * enemyTurn(parry):
 *   1. Misuse guard: anything but 'awaiting' returns an empty result.
 *   2. 'turn' event (always first).
 *   3. Enemy stun check → move skipped (upkeep still happens).
 *   4. Enemy move with the parry applied to every damaging hit (parry event is
 *      emitted before the first damage event; a parried blow applies no on-hit
 *      status). Wind-ups lock in a payoff instead of dealing damage. Echo
 *      repeats the move at 60% (still parried). Drain/siphon heal after hits.
 *      Iron-brace reflect can kill the enemy here → 'won' (player is alive by
 *      construction: reflect only fires while the player is still standing).
 *   5. Player death check → 'lost'.  Enemy death check (reflect) → 'won'.
 *   6. Player damage-over-time tick → player death check → 'lost'.
 *   7. Upkeep: turn counter, +energy, cooldowns, relentless, boss anti-stall (+5%/turn after round 20).
 *   8. New telegraph (a locked payoff wins). status = 'ongoing'.
 *
 * INVARIANTS
 *   • The enemy never acts after dying: every enemy-side effect is gated on
 *     `enemy.hp > 0`, and a win returns before enemyTurn can be called.
 *   • If the enemy is dead, the win stands: any same-beat effect that would
 *     drop the player to 0 is floored at 1 HP (see finishWin).
 *   • The player dying to their own damage-over-time while the enemy lives is
 *     a loss.
 *   • recordKill / fightsLost are bumped exactly once per fight, here.
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
import { CONSUMABLES, type ConsumableDef } from './data/consumables';
import { desc as cdesc, moveLabel, name as cname, phaseBanner, phaseName, statusText, t } from '../i18n';

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
  | 'death'
  | 'parry'
  | 'turn';

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

export type CombatStatusOutcome = 'ongoing' | 'awaiting' | 'won' | 'lost' | 'fled';
export type ParryResult = 'perfect' | 'none';

export interface TurnResult {
  events: CombatEvent[];
  status: CombatStatusOutcome;
  playerHp: number;
  enemyHp: number;
  turns: number;
  /** Present when status === 'awaiting': what the enemy is about to do. */
  incoming?: { attack: boolean; intent: Intent };
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
  /** Damage multiplier on the player's attack (bombs). */
  damage?: number;
  description: string;
  /** False for field-only items (tomes, luck charms) that do nothing mid-fight. */
  combat: boolean;
}

/**
 * Combat effects are DERIVED from data/consumables.ts so the two tables can't
 * drift: ids, names, icons and heal fractions all come from the content table.
 * Buffs are expressed as status stacks (+25% per stack), rounded to the
 * nearest stack of the advertised bonus.
 */
function effectFromDef(c: ConsumableDef): ConsumableEffect {
  const base: ConsumableEffect = {
    name: cname('consumable', c.id, c.name),
    icon: c.icon,
    description: cdesc('consumable', c.id, c.description),
    combat: c.where !== 'field'
  };
  const e = c.effect;
  switch (e.kind) {
    case 'healPct':
      return { ...base, healPct: e.value };
    case 'healFlat':
      return { ...base, heal: e.value };
    case 'cleanse':
      return { ...base, cleanse: true };
    case 'damage':
      return { ...base, damage: e.value };
    case 'buffAtk':
      return {
        ...base,
        status: { status: 'enrage', stacks: Math.max(1, Math.round(e.value / 0.25)), turns: e.turns, chance: 1, onSelf: true }
      };
    case 'buffDef':
      return {
        ...base,
        status: { status: 'fortify', stacks: Math.max(1, Math.round(e.value / 0.25)), turns: e.turns, chance: 1, onSelf: true }
      };
    default:
      return base;
  }
}

export const CONSUMABLE_EFFECTS: Record<string, ConsumableEffect> = Object.fromEntries(
  CONSUMABLES.map(c => [c.id, effectFromDef(c)])
);

export function consumableEffect(id: string): ConsumableEffect {
  return (
    CONSUMABLE_EFFECTS[id] ?? {
      name: id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      icon: '🧪',
      healPct: 0.3,
      description: 'Restores 30% HP.',
      combat: true
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

/** Multiplicative buffs snowball, so they cap low; damage-over-time can pile up. */
const STACK_CAP: Partial<Record<StatusId, number>> = { fortify: 3, enrage: 4, weaken: 4, regen: 4 };

function capFor(id: StatusId): number {
  return STACK_CAP[id] ?? MAX_STACKS;
}

/** Per-stack, per-turn magnitude of the damage/heal statuses. */
function statusPotency(id: StatusId, sourceAtk: number, sourceMaxHp: number): number {
  switch (id) {
    case 'poison':
      return Math.max(1, Math.round(sourceAtk * 0.06));
    case 'burn':
      return Math.max(1, Math.round(sourceAtk * 0.11));
    case 'bleed':
      return Math.max(1, Math.round(sourceAtk * 0.08));
    case 'regen':
      return Math.max(1, Math.round(sourceMaxHp * 0.028));
    default:
      return 0;
  }
}

export function isHarmful(id: StatusId): boolean {
  return STATUS_INFO[id].harmful;
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

  /** Set on brace, consumed by the enemy's next move. */
  private braced = false;
  /** True while a perfect parry is being applied to the current enemy move. */
  private parrying = false;
  private firstStrikeSpent = false;
  private lossCounted = false;

  constructor(player: GameState, enemy: EnemyInstance) {
    this.player = player;
    this.enemy = enemy;
    this.isBoss = enemy.isBoss;
    enemy.statuses = enemy.statuses ?? [];
    enemy.shield = 0;

    if (enemy.isBoss) {
      const script = bossScript(enemy.id);
      this.phases = script.phases;
      this.passive = script.passive ?? null;
    }

    this.abilities = resolveAbilities(player);

    // Dawnward 4-piece: every fight opens blessed. Statuses only, no events —
    // the screen renders them from `playerStatuses`.
    if (this.hasProc('dawn_blessing')) {
      this.addStatus(
        this.playerStatuses,
        { status: 'regen', stacks: 2, turns: 3, chance: 1, onSelf: true },
        statusPotency('regen', this.player.derived.atk, this.player.maxHp)
      );
      this.addStatus(this.playerStatuses, { status: 'fortify', stacks: 1, turns: 3, chance: 1, onSelf: true }, 0);
    }

    // Enraged elites start angry and get angrier when hurt (see checkEliteEnrage).
    if (enemy.isElite && enemy.ability === 'enrage') {
      this.addStatus(this.enemyStatuses, { status: 'enrage', stacks: 1, turns: 99, chance: 1, onSelf: true }, 0);
    }

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
  /** True between act() and enemyTurn(). */
  get awaiting(): boolean {
    return this.status === 'awaiting';
  }

  /** True when the telegraphed move will deal damage THIS turn (wind-ups return false). */
  get enemyWillAttack(): boolean {
    if (stackOf(this.enemyStatuses, 'stun') > 0) return false;
    const m = this.currentMove;
    return m.power > 0 && !m.payoff;
  }

  private hasProc(id: 'first_strike' | 'iron_brace' | 'ember_strikes' | 'tide_parry' | 'void_hunger' | 'dawn_blessing'): boolean {
    return this.player.setProcs.has(id);
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

  /** Armour softness: damage × mitK / (mitK + def). Scales so def keeps mattering. */
  private get mitK(): number {
    return COMBAT.mitBase + COMBAT.mitPerLevel * this.player.stats.level;
  }

  private mitigate(raw: number, def: number, pierce = 0): number {
    const eff = Math.max(0, def * (1 - clamp(pierce, 0, 1)));
    return Math.max(1, Math.round(raw * (this.mitK / (this.mitK + eff))));
  }

  /** Damage the telegraphed intent would do right now, for the UI. */
  intentDamage(): number {
    const m = this.currentMove;
    if (!m || m.power <= 0) return 0;
    return this.intentDamageFor(m);
  }

  /** A visible, honest difficulty read for the player. */
  threat(): ThreatRating {
    const myDps = this.mitigate(this.atkOf('player') * 1.25, this.defOf('enemy'));
    const theirDps = Math.max(1, this.intentDamage() || this.mitigate(this.atkOf('enemy'), this.defOf('player')));
    const ttk = Math.max(1, Math.ceil((this.enemy.hp + this.enemy.shield) / Math.max(1, myDps)));
    const ttd = Math.max(1, Math.ceil((this.playerHp + this.playerShield) / theirDps));
    const ratio = ttk / ttd;
    let level: ThreatRating['level'] = 2;
    if (ratio <= 0.25) level = 0;
    else if (ratio <= 0.55) level = 1;
    else if (ratio <= 1.0) level = 2;
    else if (ratio <= 1.6) level = 3;
    else level = 4;
    // Elites and bosses change the rules mid-fight (phases, passives, enrage);
    // a first-glance ratio is never allowed to call them a walk-over.
    if ((this.enemy.isElite || this.isBoss) && level < 2) level = 2;
    if (this.isBoss && this.phases.length > 1 && level < 3) level = 3;
    const label = ['Trivial', 'Favourable', 'Even', 'Dangerous', 'Deadly'][level];
    return { label, level, turnsToKill: ttk, turnsToDie: ttd };
  }

  /** Energy price of an ability for this player (Voidtouched: 1 less, min 1). */
  costOf(ability: CombatAbility): number {
    if (ability.cost <= 0) return 0;
    return this.hasProc('void_hunger') ? Math.max(1, ability.cost - 1) : ability.cost;
  }

  canUse(ability: CombatAbility): { ok: boolean; reason: string } {
    if ((this.cooldowns[ability.id] ?? 0) > 0)
      return { ok: false, reason: `${this.cooldowns[ability.id]}` };
    if (this.energy < this.costOf(ability)) return { ok: false, reason: 'Energy' };
    return { ok: true, reason: '' };
  }

  get playerStunned(): boolean {
    return stackOf(this.playerStatuses, 'stun') > 0;
  }

  /** Lets the screen continue a lost fight (ad revive). HP is the screen's job. */
  resume() {
    if (this.status === 'lost') {
      this.status = 'ongoing';
      this.braced = false;
      this.pendingPayoff = null;
      this.currentMove = this.chooseMove(false);
      this.intent = this.intentFor(this.currentMove);
    }
  }

  private gainEnergy(n: number) {
    this.energy = Math.min(COMBAT.maxEnergy, this.energy + n);
  }

  /* ------------------------------------------------------- player half ---- */

  act(action: PlayerAction): TurnResult {
    if (this.status !== 'ongoing') return this.result([], this.status);
    const ev: CombatEvent[] = [];

    // 2. stun
    if (this.playerStunned && action.type !== 'flee') {
      this.removeStatus(this.playerStatuses, 'stun');
      ev.push({ kind: 'info', target: 'player', text: t('combat.ev_stunned_you'), icon: '💫', hold: 0.5 });
    } else {
      // 3. action
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
          if (this.doFlee(ev)) return this.result(ev, 'fled');
          break;
        }
        case 'pass':
          ev.push({ kind: 'info', target: 'player', text: t('combat.ev_wait'), icon: '⏳', hold: 0.3 });
          this.gainEnergy(COMBAT.energyPerPass);
          break;
      }
    }

    // 4. enemy death (from the action)
    if (this.enemy.hp <= 0 && !this.tryRevive(ev)) return this.finishWin(ev);
    // 5. player death (reflect / thorns / failed flee) with the enemy alive
    if (this.player.isDead()) return this.finishLoss(ev);

    // 6. enemy damage-over-time
    this.tickStatuses(ev, 'enemy');
    if (this.enemy.hp <= 0 && !this.tryRevive(ev)) return this.finishWin(ev);

    // 7. boss / elite checks
    this.checkEliteEnrage(ev);
    this.checkRewind(ev);
    this.checkPhase(ev);

    // 8. hand over
    return this.result(ev, 'awaiting');
  }

  /* --------------------------------------------------------- enemy half ---- */

  enemyTurn(parry: ParryResult): TurnResult {
    if (this.status !== 'awaiting') return this.result([], this.status === 'ongoing' ? 'ongoing' : this.status);
    this.status = 'ongoing';
    const ev: CombatEvent[] = [];
    const m = this.currentMove;
    const stunned = stackOf(this.enemyStatuses, 'stun') > 0;

    // 2. the turn marker is always first
    ev.push({
      kind: 'turn',
      target: 'enemy',
      source: 'enemy',
      text: `${this.enemy.name} — ${stunned ? moveLabel('Stunned') : moveLabel(m.label)}`,
      label: stunned ? 'Stunned' : moveLabel(m.label),
      icon: stunned ? '💫' : m.icon,
      hold: 0.5
    });

    // 3./4. the move
    if (stunned) {
      this.removeStatus(this.enemyStatuses, 'stun');
      ev.push({ kind: 'info', target: 'enemy', text: t('combat.ev_enemy_stunned', { name: this.enemy.name }), icon: '💫', hold: 0.5 });
    } else {
      this.enemyAct(ev, m, parry);
    }
    this.braced = false;
    this.parrying = false;

    // 5. deaths caused by the move (player first: the hit lands before any reflect)
    if (this.player.isDead()) return this.finishLoss(ev);
    if (this.enemy.hp <= 0 && !this.tryRevive(ev)) return this.finishWin(ev);

    // 6. player damage-over-time
    this.tickStatuses(ev, 'player');
    if (this.player.isDead()) return this.finishLoss(ev);

    // 7. upkeep
    this.turns += 1;
    this.gainEnergy(COMBAT.energyPerTurn);
    for (const k of Object.keys(this.cooldowns)) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - 1);
    for (const k of Object.keys(this.moveCooldowns))
      this.moveCooldowns[k] = Math.max(0, this.moveCooldowns[k] - 1);
    if (this.passive === 'relentless') this.enemyAtkMult *= 1.02;
    // Anti-stall: a boss that is still standing after 20 rounds grows 5% stronger every round.
    if (this.isBoss && this.turns >= COMBAT.bossEnrageTurn) this.enemyAtkMult *= 1.05;

    // 8. next telegraph
    this.currentMove = this.pendingPayoff ?? this.chooseMove(false);
    this.intent = this.intentFor(this.currentMove);

    return this.result(ev, 'ongoing');
  }

  /* --------------------------------------------------------- player moves -- */

  private doBasic(ev: CombatEvent[]) {
    ev.push({ kind: 'action', target: 'enemy', source: 'player', text: t('combat.strike'), label: t('combat.strike'), icon: '⚔️', fx: 'slash' });
    this.strike(ev, 1, {});
    this.gainEnergy(COMBAT.energyPerBasic);
  }

  private doAbility(ev: CombatEvent[], id: string) {
    const ab = this.abilities.find(a => a.id === id) ?? abilityById(id);
    if (!ab) return this.doBasic(ev);
    const check = this.canUse(ab);
    if (!check.ok) {
      ev.push({ kind: 'info', target: 'player', text: t('combat.ev_not_ready'), hold: 0.2 });
      return;
    }
    this.energy -= this.costOf(ab);
    if (ab.cooldown > 0) this.cooldowns[ab.id] = ab.cooldown + 1;
    if (ab.energyGain) this.gainEnergy(ab.energyGain);

    ev.push({
      kind: 'action',
      target: ab.kind === 'attack' ? 'enemy' : 'player',
      source: 'player',
      text: cname('ability', ab.id, ab.name),
      label: cname('ability', ab.id, ab.name),
      icon: ab.icon,
      fx: ab.fx ?? 'arcane'
    });

    if (ab.cleanse) {
      const removed = this.playerStatuses.filter(s => isHarmful(s.id)).length;
      this.playerStatuses = this.playerStatuses.filter(s => !isHarmful(s.id));
      if (removed > 0)
        ev.push({ kind: 'status', target: 'player', text: t('combat.ev_cleansed'), icon: '✨', hold: 0.35 });
    }
    if (ab.healPct) {
      const amount = Math.round(this.playerMaxHp * ab.healPct);
      this.healPlayer(ev, amount);
    }
    if (ab.shieldFromDef || ab.shieldFromHp) {
      const amount = Math.round(
        this.player.derived.def * (ab.shieldFromDef ?? 0) + this.playerMaxHp * (ab.shieldFromHp ?? 0)
      );
      this.playerShield += amount;
      ev.push({ kind: 'shield', target: 'player', amount, text: `+${amount} shield`, icon: '🛡️', hold: 0.35 });
    }
    if (ab.power > 0) {
      const hits = ab.hits ?? 1;
      for (let i = 0; i < hits; i++) {
        if (this.enemy.hp <= 0 || this.player.isDead()) break;
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

  private applyFromPlayer(ev: CombatEvent[], app: StatusApplication, quiet = false) {
    if (Math.random() > app.chance) return;
    const onSelf = !!app.onSelf;
    const target: Side = onSelf ? 'player' : 'enemy';
    if (!onSelf && this.enemy.hp <= 0) return;
    const list = onSelf ? this.playerStatuses : this.enemyStatuses;
    const fresh = !list.some(s => s.id === app.status);
    this.addStatus(list, app, statusPotency(app.status, this.atkOf('player'), this.playerMaxHp));
    if (quiet && !fresh) return;
    ev.push({
      kind: 'status',
      target,
      text: statusText(app.status, app.stacks),
      icon: STATUS_INFO[app.status].icon,
      hold: quiet ? 0.22 : 0.32
    });
  }

  private doBrace(ev: CombatEvent[]) {
    // Shields scale off UNBUFFED defense so brace → fortify → bigger brace can't snowball.
    let amount = Math.round(this.player.derived.def * COMBAT.braceShieldDef + this.playerMaxHp * COMBAT.braceShieldHp);
    if (this.hasProc('iron_brace')) amount *= 2;
    this.playerShield += amount;
    if (stackOf(this.playerStatuses, 'fortify') < 2)
      this.addStatus(this.playerStatuses, { status: 'fortify', stacks: 1, turns: 2, chance: 1 }, 0);
    this.gainEnergy(COMBAT.energyPerBrace);
    ev.push({
      kind: 'action',
      target: 'player',
      source: 'player',
      text: t('combat.brace'),
      label: t('combat.brace'),
      icon: '🛡️',
      fx: 'guard'
    });
    ev.push({ kind: 'shield', target: 'player', amount, text: `+${amount} shield`, icon: '🛡️', hold: 0.4 });
    this.braced = true;
  }

  private doItem(ev: CombatEvent[], id: string) {
    const eff = consumableEffect(id);
    if (!eff.combat) {
      ev.push({ kind: 'info', target: 'player', text: t('combat.ev_not_now'), hold: 0.2 });
      return;
    }
    if (!this.player.useConsumable(id)) {
      ev.push({ kind: 'info', target: 'player', text: t('combat.ev_none_left'), hold: 0.2 });
      return;
    }
    ev.push({
      kind: 'action',
      target: eff.damage ? 'enemy' : 'player',
      source: 'player',
      text: eff.name,
      label: eff.name,
      icon: eff.icon,
      fx: eff.damage ? 'fire' : 'heal'
    });
    if (eff.cleanse) {
      this.playerStatuses = this.playerStatuses.filter(s => !isHarmful(s.id));
      ev.push({ kind: 'status', target: 'player', text: t('combat.ev_cleansed'), icon: '✨', hold: 0.3 });
    }
    if (eff.healPct || eff.heal) {
      const amount = Math.round((eff.heal ?? 0) + this.playerMaxHp * (eff.healPct ?? 0));
      this.healPlayer(ev, amount);
    }
    if (eff.energy) {
      this.gainEnergy(eff.energy);
      ev.push({ kind: 'info', target: 'player', text: t('combat.ev_energy', { n: eff.energy }), icon: '⚡', hold: 0.3 });
    }
    if (eff.status) this.applyFromPlayer(ev, eff.status);
    if (eff.damage) this.strike(ev, eff.damage, { pierce: 0.5, fx: 'fire', noProcs: true });
  }

  private doFlee(ev: CombatEvent[]): boolean {
    if (this.isBoss) {
      ev.push({ kind: 'info', target: 'player', text: t('combat.ev_no_escape'), icon: '🚫', hold: 0.5 });
      return false;
    }
    const chance = COMBAT.fleeChance - (this.enemy.isElite ? 0.2 : 0);
    if (Math.random() < chance) {
      ev.push({ kind: 'flee', target: 'player', text: t('combat.ev_break_away'), icon: '💨', hold: 0.6 });
      return true;
    }
    ev.push({ kind: 'info', target: 'player', text: t('combat.ev_escape_failed'), icon: '💢', hold: 0.45 });
    // A failed escape costs you: the enemy gets a free swing.
    const raw = this.atkOf('enemy') * 1.1 * variance();
    const dmg = this.mitigate(raw, this.defOf('player'));
    this.damagePlayer(ev, dmg, { fromIntent: false, fx: 'slash' });
    return false;
  }

  /* ------------------------------------------------------- damage plumbing -- */

  private strike(
    ev: CombatEvent[],
    power: number,
    o: { pierce?: number; execute?: number; drain?: number; critBonus?: number; fx?: string; multi?: boolean; noProcs?: boolean }
  ) {
    if (this.enemy.hp <= 0) return;
    const d = this.player.derived;
    let raw = this.atkOf('player') * power * variance();
    if (o.execute) {
      const missing = 1 - this.enemy.hp / Math.max(1, this.enemy.maxHp);
      raw *= 1 + o.execute * missing;
    }
    // Wolfpack 4-piece: the opening blow lands +50% and bleeds.
    const firstStrike = !o.noProcs && !this.firstStrikeSpent && this.hasProc('first_strike');
    if (firstStrike) raw *= 1.5;
    this.firstStrikeSpent = true;

    const crit = Math.random() < clamp(d.critChance + (o.critBonus ?? 0), 0, 0.95);
    let dmg = this.mitigate(raw, this.defOf('enemy'), o.pierce ?? 0);
    if (crit) dmg = Math.round(dmg * d.critDamage);

    const absorbed = Math.min(this.enemy.shield, dmg);
    this.enemy.shield -= absorbed;
    const through = dmg - absorbed;
    this.enemy.hp = Math.max(0, this.enemy.hp - through);
    this.player.stats.damageDealt = (this.player.stats.damageDealt ?? 0) + dmg;

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

    const heal = Math.round(dmg * (d.lifesteal + (o.drain ?? 0)));
    if (heal > 0 && this.playerHp < this.playerMaxHp) this.healPlayer(ev, heal);

    // Everything below is a reaction of a LIVING enemy. A killing blow ends here.
    if (this.enemy.hp <= 0) return;

    if (this.passive === 'adaptive' && crit && stackOf(this.enemyStatuses, 'fortify') < 3) {
      this.addStatus(this.enemyStatuses, { status: 'fortify', stacks: 1, turns: 3, chance: 1 }, 0);
      ev.push({ kind: 'status', target: 'enemy', text: t('combat.ev_adapts'), icon: '🧱', hold: 0.28 });
    }

    if (firstStrike) this.applyFromPlayer(ev, { status: 'bleed', stacks: 2, turns: 3, chance: 1 });
    if (!o.noProcs && this.hasProc('ember_strikes'))
      this.applyFromPlayer(ev, { status: 'burn', stacks: 1, turns: 2, chance: 1 }, true);

    // Reflect: elite ability + the thorns passive.
    const reflectPct = (this.enemy.isElite && this.enemy.ability === 'reflect' ? 0.2 : 0) + (this.passive === 'thorns' ? 0.15 : 0);
    if (reflectPct > 0 && through > 0 && !this.player.isDead()) {
      const back = Math.max(1, Math.round(through * reflectPct));
      ev.push({ kind: 'info', target: 'player', text: t('combat.ev_reflected'), icon: '🌵', fx: 'reflect', hold: 0.25 });
      this.damagePlayer(ev, back, { fromIntent: false });
    }
  }

  private healPlayer(ev: CombatEvent[], amount: number) {
    const before = this.playerHp;
    this.player.heal(amount);
    const gained = this.playerHp - before;
    if (gained > 0) {
      ev.push({ kind: 'heal', target: 'player', amount: gained, text: `+${gained}`, icon: '💚', hold: 0.3 });
      // Devour: only a real heal (5%+ of max HP) feeds it, and it caps at 4 stacks.
      if (this.passive === 'devour' && this.enemy.hp > 0 && gained >= this.playerMaxHp * 0.05 && stackOf(this.enemyStatuses, 'enrage') < 3) {
        this.addStatus(this.enemyStatuses, { status: 'enrage', stacks: 1, turns: 4, chance: 1 }, 0);
        ev.push({ kind: 'status', target: 'enemy', text: t('combat.ev_feeds'), icon: '🍽️', hold: 0.3 });
      }
    }
  }

  /**
   * Lands damage on the player. Brace and a perfect parry both scale a
   * telegraphed hit; stacked they never go below `parryFloor` of the raw hit.
   */
  private damagePlayer(ev: CombatEvent[], amount: number, o: { fromIntent: boolean; fx?: string }): number {
    const raw = Math.max(1, Math.round(amount));
    let mult = 1;
    if (o.fromIntent && this.braced) mult *= 1 - COMBAT.defendReduction;
    if (o.fromIntent && this.parrying) mult *= COMBAT.parryMultiplier;
    if (o.fromIntent) mult = Math.max(mult, COMBAT.parryFloor);
    const dmg = Math.max(1, Math.round(raw * mult));

    const absorbed = Math.min(this.playerShield, dmg);
    this.playerShield -= absorbed;
    const through = dmg - absorbed;
    this.player.takeDamage(through);
    this.player.stats.damageTaken = (this.player.stats.damageTaken ?? 0) + dmg;
    if (absorbed > 0 && through === 0) {
      ev.push({ kind: 'block', target: 'player', amount: absorbed, text: `${absorbed} blocked`, icon: '🛡️', hold: 0.3 });
    } else {
      ev.push({
        kind: 'damage',
        target: 'player',
        source: 'enemy',
        amount: dmg,
        text: `${dmg}`,
        fx: o.fx,
        hold: 0.3
      });
    }
    // Ironbound 4-piece: the wall bites back for 30% of what it stopped.
    if (absorbed > 0 && o.fromIntent && this.braced && this.hasProc('iron_brace') && this.enemy.hp > 0 && !this.player.isDead()) {
      const back = Math.max(1, Math.round(absorbed * 0.3));
      const soak = Math.min(this.enemy.shield, back);
      this.enemy.shield -= soak;
      this.enemy.hp = Math.max(0, this.enemy.hp - (back - soak));
      this.player.stats.damageDealt = (this.player.stats.damageDealt ?? 0) + back;
      ev.push({ kind: 'damage', target: 'enemy', source: 'player', amount: back, text: `${back}`, icon: '⚙️', fx: 'blunt', hold: 0.25 });
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
    return { kind: m.kind, label: moveLabel(m.label), icon: m.icon, value };
  }

  private intentDamageFor(m: EnemyMove): number {
    const raw = this.atkOf('enemy') * m.power;
    return this.mitigate(raw, this.defOf('player'), m.pierce ?? 0) * (m.hits ?? 1);
  }

  /** The enemy's telegraphed move, with the parry outcome applied. */
  private enemyAct(ev: CombatEvent[], m: EnemyMove, parry: ParryResult) {
    this.lastMoveId = m.id;
    if (m.cooldown) this.moveCooldowns[m.id] = m.cooldown + 1;

    ev.push({
      kind: 'action',
      target: m.power > 0 ? 'player' : 'enemy',
      source: 'enemy',
      text: moveLabel(m.label),
      label: moveLabel(m.label),
      icon: m.icon,
      fx: m.kind === 'heavy' || m.kind === 'special' ? 'heavy' : 'slash'
    });

    if (m.payoff) {
      // Wind-up: nothing happens now, but the payoff is locked in for next turn.
      this.pendingPayoff = { ...(m.payoff as EnemyMove), id: `${m.id}_p`, weight: 0 };
      ev.push({
        kind: 'info',
        target: 'enemy',
        text: t('combat.ev_incoming', { move: moveLabel(m.payoff.label) }),
        icon: m.payoff.icon,
        fx: 'incoming',
        hold: 0.6
      });
      return;
    }
    this.pendingPayoff = null;

    if (parry === 'perfect' && m.power > 0) {
      this.parrying = true;
      ev.push({ kind: 'parry', target: 'player', source: 'player', text: t('combat.ev_perfect_parry'), label: 'PARRY', icon: '🛡️', hold: 0.5 });
      this.gainEnergy(COMBAT.energyPerParry);
      this.player.stats.perfectParries = (this.player.stats.perfectParries ?? 0) + 1;
      if (this.hasProc('tide_parry')) {
        this.healPlayer(ev, Math.round(this.playerMaxHp * 0.08));
        const shield = Math.round(this.defOf('player') * 0.5);
        this.playerShield += shield;
        ev.push({ kind: 'shield', target: 'player', amount: shield, text: `+${shield} shield`, icon: '🌊', hold: 0.3 });
      }
    }

    this.resolveEnemyMove(ev, m, 1);

    if (this.passive === 'echo' && this.enemy.hp > 0) {
      this.echoCounter += 1;
      if (this.echoCounter % 3 === 0 && m.power > 0 && !this.player.isDead()) {
        ev.push({ kind: 'info', target: 'enemy', text: t('combat.ev_echo'), icon: '🔁', hold: 0.35 });
        this.resolveEnemyMove(ev, m, 0.6);
      }
    }
  }

  private resolveEnemyMove(ev: CombatEvent[], m: EnemyMove, scale: number) {
    if (this.enemy.hp <= 0) return;
    const critChance = this.isBoss ? 0.12 : 0.08;
    const parried = this.parrying;
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
        if (this.player.isDead() || this.enemy.hp <= 0) break;
        const crit = Math.random() < critChance;
        let raw = this.atkOf('enemy') * m.power * scale * variance();
        if (crit) raw *= 1.6;
        const dmg = this.mitigate(raw, this.defOf('player'), m.pierce ?? 0);
        dealt += this.damagePlayer(ev, dmg, { fromIntent: true, fx: m.kind === 'heavy' || m.kind === 'special' ? 'heavy' : 'slash' });
      }
      const drain = (m.drain ?? 0) + (this.enemy.isElite && this.enemy.ability === 'lifesteal' ? 0.2 : 0) + (this.passive === 'siphon' ? 0.15 : 0);
      if (drain > 0 && dealt > 0 && this.enemy.hp > 0) {
        const heal = Math.max(1, Math.round(dealt * drain));
        this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + heal);
        ev.push({ kind: 'heal', target: 'enemy', amount: heal, text: `+${heal}`, icon: '🧛', hold: 0.3 });
      }
      if (this.passive === 'hoarfrost' && !parried && !this.player.isDead() && this.enemy.hp > 0 && stackOf(this.playerStatuses, 'weaken') < 3) {
        this.applyFromEnemy(ev, { status: 'weaken', stacks: 1, turns: 2, chance: 1 });
      }
    }
    // A parried blow doesn't bite: its on-hit afflictions are cancelled. Self-buffs still happen.
    if (m.applies && (!parried || m.applies.onSelf)) this.applyFromEnemy(ev, m.applies);
    if (m.applies2 && (!parried || m.applies2.onSelf)) this.applyFromEnemy(ev, m.applies2);
  }

  private applyFromEnemy(ev: CombatEvent[], app: StatusApplication) {
    if (this.enemy.hp <= 0) return;
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
      text: statusText(app.status, app.stacks),
      icon: STATUS_INFO[app.status].icon,
      hold: 0.32
    });
  }

  /* --------------------------------------------------------------- phases -- */

  private eliteEnraged = false;

  /** Elite 'enrage' ability: below half HP it gains two more stacks, once. */
  private checkEliteEnrage(ev: CombatEvent[]) {
    if (!this.enemy.isElite || this.enemy.ability !== 'enrage' || this.eliteEnraged || this.enemy.hp <= 0) return;
    if (this.enemy.hp > this.enemy.maxHp * 0.5) return;
    this.eliteEnraged = true;
    this.addStatus(this.enemyStatuses, { status: 'enrage', stacks: 2, turns: 99, chance: 1, onSelf: true }, 0);
    ev.push({ kind: 'status', target: 'enemy', text: t('combat.ev_enraged', { name: this.enemy.name }), icon: '😤', hold: 0.5 });
  }

  private checkRewind(ev: CombatEvent[]) {
    if (this.passive !== 'rewind' || this.rewound || this.enemy.hp <= 0) return;
    if (this.enemy.hp / Math.max(1, this.enemy.maxHp) >= 0.4) return;
    this.rewound = true;
    const target = Math.round(this.enemy.maxHp * 0.55);
    const amount = Math.max(0, target - this.enemy.hp);
    this.enemy.hp = target;
    ev.push({ kind: 'info', target: 'enemy', text: t('combat.ev_rewind'), icon: '⏳', hold: 1.0 });
    if (amount > 0) ev.push({ kind: 'heal', target: 'enemy', amount, text: `+${amount}`, icon: '⏳', hold: 0.4 });
  }

  private checkPhase(ev: CombatEvent[]) {
    if (!this.isBoss || this.enemy.hp <= 0) return;
    const frac = this.enemy.hp / Math.max(1, this.enemy.maxHp);
    while (this.phaseIndex + 1 < this.phases.length && frac <= this.phases[this.phaseIndex + 1].at) {
      this.phaseIndex += 1;
      const phase = this.phases[this.phaseIndex];
      ev.push({
        kind: 'phase',
        target: 'enemy',
        text: phaseBanner(this.enemy.id, this.phaseIndex, phase.banner),
        label: phaseName(this.enemy.id, this.phaseIndex, phase.name),
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
          const had = this.playerStatuses.some(s => !isHarmful(s.id)) || this.playerShield > 0;
          this.playerStatuses = this.playerStatuses.filter(s => isHarmful(s.id));
          this.playerShield = 0;
          if (had) ev.push({ kind: 'status', target: 'player', text: t('combat.ev_stripped'), icon: '🚫', hold: 0.5 });
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
      this.enemy.statuses = [];
      ev.push({
        kind: 'revive',
        target: 'enemy',
        text: t('combat.ev_rises', { name: this.enemy.name }),
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
    const cap = capFor(app.status);
    const existing = list.find(s => s.id === app.status);
    if (existing) {
      existing.stacks = Math.min(cap, existing.stacks + app.stacks);
      existing.turns = Math.max(existing.turns, app.turns);
      existing.potency = Math.max(existing.potency, potency);
    } else {
      list.push({ id: app.status, stacks: Math.min(cap, app.stacks), turns: app.turns, potency });
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
          this.player.stats.damageTaken = (this.player.stats.damageTaken ?? 0) + dmg;
        } else {
          this.enemy.hp = Math.max(0, this.enemy.hp - dmg);
          this.player.stats.damageDealt = (this.player.stats.damageDealt ?? 0) + dmg;
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
        else if (this.enemy.hp > 0) {
          this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + amount);
          ev.push({ kind: 'heal', target: 'enemy', amount, text: `+${amount}`, icon: '💚', hold: 0.28 });
        }
      }
      if (s.id !== 'stun') {
        s.turns -= 1;
        if (s.turns <= 0) list.splice(i, 1);
      }
      if (side === 'player' && this.player.isDead()) break;
      if (side === 'enemy' && this.enemy.hp <= 0) break;
    }
    // Shields decay so defence has to be re-earned.
    if (side === 'player') this.playerShield = Math.round(this.playerShield * 0.5);
    else this.enemy.shield = Math.round(this.enemy.shield * 0.5);
  }

  /* ---------------------------------------------------------------- finish -- */

  private finishWin(ev: CombatEvent[]): TurnResult {
    // The win stands: nothing that landed in the same beat may leave the player dead.
    if (this.player.stats.hp <= 0) this.player.stats.hp = 1;
    this.player.recordKill(this.enemy.id, this.enemy.isBoss);
    ev.push({ kind: 'death', target: 'enemy', text: t('combat.ev_falls', { name: this.enemy.name }), icon: '💀', hold: 0.9 });
    // Voidtouched 4-piece: the kill feeds you — this is what carries into the next fight.
    if (this.hasProc('void_hunger')) {
      this.gainEnergy(3);
      this.healPlayer(ev, Math.round(this.playerMaxHp * 0.2));
    }
    return this.result(ev, 'won');
  }

  private finishLoss(ev: CombatEvent[]): TurnResult {
    if (!this.lossCounted) {
      this.lossCounted = true;
      this.player.stats.fightsLost = (this.player.stats.fightsLost ?? 0) + 1;
    }
    this.braced = false;
    this.parrying = false;
    ev.push({ kind: 'death', target: 'player', text: t('combat.ev_you_fall'), icon: '💀', hold: 0.9 });
    return this.result(ev, 'lost');
  }

  private result(events: CombatEvent[], status: CombatStatusOutcome): TurnResult {
    this.status = status;
    const out: TurnResult = { events, status, playerHp: this.playerHp, enemyHp: this.enemy.hp, turns: this.turns };
    if (status === 'awaiting') out.incoming = { attack: this.enemyWillAttack, intent: this.intent };
    return out;
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

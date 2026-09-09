import type { CombatParams, GameContext, RewardParams, Screen, ScreenParams } from '../core/context';
import type { CombatAbility } from '../game/data/abilities';
import { STATUS_INFO } from '../game/data/abilities';
import { Combat, type CombatEvent, type ParryResult, type PlayerAction, type TurnResult } from '../game/combat';
import { combatConsumables } from '../game/data/consumables';
import { dominantElement, elementOf } from '../game/data/items';
import type { EnemyInstance, StatusEffect } from '../game/types';
import type { FxElement } from '../render/api';
import { weaponFamily } from '../render/hero';
import { CombatArena, type AttackKind, type Side } from './combat/arena';
import { VitalBar } from './combat/bars';
import { FightLog, type LogLine } from './combat/log';
import { desc as cdesc, moveLabel, name as cname, phaseName, statusDesc, statusName, t, tn } from '../i18n';

/* ============================================================================
 * The fight. A dedicated screen, nothing to do with the road.
 *
 * A round is two engine calls with choreography in between:
 *
 *   take(action) → combat.act(action) → play its beats
 *     → status 'awaiting'?
 *         enemy will attack  → banner + PARRY QTE (enemy lunges over ~1 s,
 *                               a ring closes on the hero, tap on impact)
 *         otherwise          → banner, enemy casts
 *       → combat.enemyTurn(parry) → play its beats → unlock
 *
 * Beats are timed events. An 'action' beat starts a CONTACT attack in the
 * arena and holds exactly until the blow lands, so the damage beat — number,
 * flash, element impact — fires at the instant of contact. Input is locked
 * while beats or the QTE run; the parry tap is the one exception.
 * ========================================================================== */

/** Minimum dwell per event kind (seconds). The engine's suggestions are floors, not ceilings. */
const MIN_HOLD: Partial<Record<CombatEvent['kind'], number>> = {
  damage: 0.62,
  crit: 0.7,
  block: 0.6,
  heal: 0.6,
  shield: 0.5,
  status: 0.5,
  dot: 0.6,
  info: 0.6,
  phase: 1.6,
  revive: 1.4,
  death: 1.0,
  turn: 0.7,
  parry: 0.5,
  flee: 0.6,
  action: 0.7
};

/** Parry timing window on each side of impact, seconds. */
const PARRY_WINDOW = 0.11;
/** How long the enemy's lunge takes during the QTE. */
const QTE_APPROACH = 1.0;
/** The banner sits alone for this long before the lunge starts. */
const QTE_BANNER = 0.6;

const RANGED_FAMILIES = new Set(['bow', 'staff', 'wand', 'sceptre', 'chakram']);

interface Beat {
  event: CombatEvent;
  hold: number;
  /** The strike for this hit has already been choreographed. */
  armed?: boolean;
  /** Already shown another way (banner/QTE): write it to the log and move on. */
  logOnly?: boolean;
}

interface Qte {
  /** Seconds since the lunge started. */
  t: number;
  /** When the blow lands. */
  hitAt: number;
  tapped: boolean;
  result: ParryResult;
  resolved: boolean;
  froze: boolean;
}

type Phase = 'intro' | 'player' | 'enemy' | 'over';

export class CombatScreen implements Screen {
  readonly id = 'combat' as const;

  private ctx!: GameContext;
  private el!: HTMLElement;
  private arena!: CombatArena;
  private combat!: Combat;
  private enemy!: EnemyInstance;
  private params!: CombatParams;
  private log!: FightLog;

  private ro?: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private timers: number[] = [];

  private queue: Beat[] = [];
  private beatTimer = 0;
  private busy = true;
  private finished = false;
  private phase: Phase = 'intro';
  private pendingOutcome: TurnResult['status'] = 'ongoing';
  private pendingIncoming: TurnResult['incoming'] = undefined;
  private qte: Qte | null = null;
  /** Set when the next hit beat's strike is already in motion. */
  private armed = false;
  private reflectNext = false;
  private bannerTimer = 0;
  private melee = true;
  private rangedPose: 'attack' | 'cast' = 'attack';
  private attackElement: FxElement = 'steel';
  private parryElement: FxElement = 'steel';
  private hpBar!: VitalBar;
  private foeBar!: VitalBar;
  private sheetClose: (() => void) | null = null;
  private logSheetBody: HTMLElement | null = null;

  private q!: (sel: string) => HTMLElement;

  /* ------------------------------------------------------------- lifecycle -- */

  mount(root: HTMLElement, ctx: GameContext, params: ScreenParams) {
    this.ctx = ctx;
    this.params = params as CombatParams;
    this.enemy = this.params.enemy;
    this.combat = new Combat(ctx.state, this.enemy);
    this.log = new FightLog(this.enemy.name);
    // Singleton screen: reset every per-fight field, or the second fight
    // starts already finished.
    this.queue = [];
    this.beatTimer = 0;
    this.busy = true;
    this.finished = false;
    this.phase = 'intro';
    this.pendingOutcome = 'ongoing';
    this.pendingIncoming = undefined;
    this.qte = null;
    this.armed = false;
    this.reflectNext = false;
    this.bannerTimer = 0;
    this.sheetClose = null;
    this.logSheetBody = null;

    const fam = weaponFamily(ctx.state.equipment.weapon?.baseId ?? null);
    this.melee = !(fam && RANGED_FAMILIES.has(fam));
    this.rangedPose = fam === 'bow' || fam === 'chakram' ? 'attack' : 'cast';
    // The slot's own set wins; otherwise the set you wear most of colours the move.
    const eq = ctx.state.equipment;
    this.attackElement = ((elementOf(eq, 'weapon') ?? dominantElement(eq)) as FxElement | null) ?? 'steel';
    this.parryElement = ((elementOf(eq, 'offhand') ?? dominantElement(eq)) as FxElement | null) ?? 'steel';

    const el = document.createElement('div');
    el.className = 'screen screen-combat';
    if (this.enemy.isBoss) el.classList.add('is-boss');
    else if (this.enemy.isElite) el.classList.add('is-elite');
    el.innerHTML = this.template();
    root.appendChild(el);
    this.el = el;
    this.q = sel => el.querySelector(sel) as HTMLElement;

    this.arena = new CombatArena(el.querySelector('.cb-canvas') as HTMLCanvasElement, ctx, this.enemy);
    this.arena.resize();
    this.ro = new ResizeObserver(() => this.arena.resize());
    this.ro.observe(el);

    this.hpBar = new VitalBar(this.q('.cb-hero-hp'));
    this.foeBar = new VitalBar(this.q('.cb-enemy-hp'));

    this.buildActions();
    this.bindChrome();
    this.log.onChange = () => this.onLogChange();
    this.syncAll();

    ctx.music.setMode(this.enemy.isBoss ? 'boss' : 'combat');
    ctx.audio.play(this.enemy.isBoss ? 'boss' : 'swoosh');
    if (this.enemy.isBoss) this.shake(10, 500);

    // Intro banner, then hand control over.
    const banner = this.q('.cb-intro');
    banner.classList.add('is-on');
    this.after(1.15, () => {
      banner.classList.remove('is-on');
      this.unlock();
    });

    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__combat = this;
  }

  unmount() {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    this.ro?.disconnect();
    this.ro = undefined;
    this.sheetClose?.();
    this.ctx.fx.clear();
    this.el.remove();
    if (import.meta.env.DEV) delete (window as unknown as Record<string, unknown>).__combat;
  }

  /* ----------------------------------------------------------------- view -- */

  private template(): string {
    const e = this.enemy;
    const tag = e.isBoss ? t('combat.tag_boss') : e.isElite ? t('combat.tag_elite') : '';
    const pips = Array.from({ length: 10 }, () => '<i></i>').join('');
    return `
      <canvas class="cb-canvas"></canvas>
      <div class="cb-vignette" aria-hidden="true"></div>

      <div class="cb-top">
        <div class="cb-enemy-card">
          <div class="cb-enemy-line">
            ${tag ? `<span class="cb-tag">${esc(tag)}</span>` : ''}
            <button class="cb-enemy-name" type="button">${esc(e.name)}${e.isBoss ? ' <u>ⓘ</u>' : ''}</button>
            <span class="cb-threat chip"></span>
          </div>
          ${e.title ? `<div class="cb-enemy-title">${esc(e.title)}</div>` : ''}
          <div class="cb-enemy-hp bar bar-hp bar-lg cb-vital">
            <i class="cb-bar-ghost"></i>
            <i class="bar-fill"></i>
            <u class="cb-shield"></u>
            <b class="bar-label cb-enemy-hp-txt"></b>
          </div>
          <div class="cb-enemy-sub">
            <span class="cb-phase"></span>
            <span class="cb-enemy-shield-txt"></span>
          </div>
          <div class="cb-status cb-status-enemy"></div>
        </div>
        <div class="cb-intent">
          <span class="cb-intent-icon">❔</span>
          <span class="cb-intent-body">
            <b class="cb-intent-label">…</b>
            <i class="cb-intent-sub"></i>
          </span>
        </div>
      </div>

      <div class="cb-turn-banner"><i></i><b></b><u></u></div>

      <div class="cb-strip">
        <span class="cb-strip-text"></span>
        <button class="cb-strip-btn" type="button" aria-label="${esc(t('combat.fight_log'))}">📜</button>
      </div>

      <div class="cb-bottom">
        <button class="cb-parry-pad" type="button"><b>⛨ ${esc(t('combat.parry'))}</b><u>${esc(t('combat.parry_hint'))}</u></button>
        <div class="cb-hero-card">
          <div class="cb-hero-line">
            <span class="cb-hero-name">${esc(t('common.you'))}</span>
            <span class="cb-hero-shield-txt"></span>
            <span class="cb-status cb-status-hero"></span>
          </div>
          <div class="cb-hero-hp bar bar-hp bar-lg cb-vital">
            <i class="cb-bar-ghost"></i>
            <i class="bar-fill"></i>
            <u class="cb-shield"></u>
            <b class="bar-label cb-hero-hp-txt"></b>
          </div>
          <div class="cb-energy-row">
            <span class="cb-energy-label">${esc(t('combat.en'))}</span>
            <div class="cb-pips">${pips}</div>
            <b class="cb-energy-txt">0</b>
          </div>
        </div>
        <div class="cb-actions"></div>
        <div class="cb-minor">
          <button class="btn btn-ghost btn-sm cb-brace">🛡 ${esc(t('combat.brace'))}</button>
          <button class="btn btn-ghost btn-sm cb-item">🧪 ${esc(t('combat.item'))}</button>
          <button class="btn btn-ghost btn-sm cb-flee">🏃 ${esc(t('combat.flee'))}</button>
        </div>
      </div>

      <div class="cb-intro"><span class="cb-intro-name">${esc(this.enemy.name)}</span><span class="cb-intro-sub">${esc(this.enemy.title ?? (this.enemy.isBoss ? t('combat.blocks_road') : t('combat.blocks_path')))}</span></div>
      <div class="cb-end"></div>
    `;
  }

  private buildActions() {
    const host = this.q('.cb-actions');
    host.innerHTML = '';

    const basic = document.createElement('button');
    basic.className = 'btn btn-primary cb-act cb-act-basic';
    basic.innerHTML = `<i>⚔</i><b>${esc(t('combat.strike'))}</b><u>${esc(t('combat.strike_sub'))}</u>`;
    basic.addEventListener('click', () => this.onAction({ type: 'basic' }));
    host.appendChild(basic);

    for (const ability of this.combat.abilities) {
      host.appendChild(this.abilityButton(ability));
    }
    this.cleanups.push(() => (host.innerHTML = ''));

    this.bind('.cb-brace', () => this.take({ type: 'brace' }));
    this.bind('.cb-flee', () => this.take({ type: 'flee' }));
    this.bind('.cb-item', () => this.openItems());
  }

  private abilityButton(ability: CombatAbility): HTMLElement {
    const b = document.createElement('button');
    b.className = `btn cb-act cb-act-ability cb-fx-${ability.fx ?? 'slash'}`;
    b.dataset.ability = ability.id;
    b.innerHTML = `
      <i>${ability.icon}</i>
      <b>${esc(cname('ability', ability.id, ability.name))}</b>
      <u class="cb-cost">${esc(t('combat.cost', { n: this.combat.costOf(ability) }))}</u>
      <s class="cb-cd"></s>`;
    b.addEventListener('click', () => {
      if (this.busy || this.finished) return;
      const { ok, reason } = this.combat.canUse(ability);
      if (!ok) {
        this.ctx.toast(reason === 'Energy' ? t('combat.not_enough_energy') : t('combat.ready_in', { n: reason }), 'bad');
        this.ctx.audio.play('ui_back');
        return;
      }
      this.onAction({ type: 'ability', id: ability.id });
    });
    b.addEventListener('contextmenu', e => {
      e.preventDefault();
      this.ctx.toast(t('combat.ability_tip', { name: cname('ability', ability.id, ability.name), desc: cdesc('ability', ability.id, ability.description) }));
    });
    return b;
  }

  private onAction(action: PlayerAction) {
    if (this.busy || this.finished) return;
    this.ctx.audio.play('ui_tap');
    this.take(action);
  }

  private bind(sel: string, fn: () => void) {
    const node = this.el.querySelector(sel) as HTMLElement | null;
    if (!node) return;
    const handler = () => {
      if (this.busy || this.finished) return;
      this.ctx.audio.play('ui_tap');
      fn();
    };
    node.addEventListener('click', handler);
    this.cleanups.push(() => node.removeEventListener('click', handler));
  }

  /** Buttons that work whether or not the beat player is busy. */
  private bindChrome() {
    const strip = this.q('.cb-strip-btn');
    const onLog = () => {
      this.ctx.audio.play('ui_tap');
      this.openLog();
    };
    strip.addEventListener('click', onLog);
    this.cleanups.push(() => strip.removeEventListener('click', onLog));

    const name = this.q('.cb-enemy-name');
    const onName = () => {
      this.ctx.audio.play('ui_tap');
      this.openBossInfo();
    };
    name.addEventListener('click', onName);
    this.cleanups.push(() => name.removeEventListener('click', onName));

    // The parry tap: anywhere on the screen while the ring is closing.
    const onTap = (e: PointerEvent) => {
      if (!this.qte || this.qte.tapped) return;
      if ((e.target as HTMLElement).closest('.sheet-scrim')) return;
      e.preventDefault();
      this.onParryTap();
    };
    this.el.addEventListener('pointerdown', onTap, { capture: true });
    this.cleanups.push(() => this.el.removeEventListener('pointerdown', onTap, { capture: true }));
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && this.qte && !this.qte.tapped) {
        e.preventDefault();
        this.onParryTap();
      }
    };
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));
  }

  /* ----------------------------------------------------------------- turn -- */

  /** The player's half of a round. Public so the DEV harness can drive it. */
  take(action: PlayerAction) {
    if (this.busy || this.finished) return;
    this.busy = true;
    this.phase = 'player';
    this.syncActions();
    this.log.startRound(this.combat.turns + 1);
    const result = this.combat.act(action);
    this.enqueue(result, false);
  }

  private enqueue(result: TurnResult, fromQte: boolean, logOnly: CombatEvent['kind'][] = []) {
    this.queue = result.events.map(event => ({
      event,
      // Multi-hit moves (the engine marks them with a short hold) keep a
      // tighter rhythm; everything else gets the full readable dwell.
      hold: Math.max(event.hold ?? 0.34, this.isHit(event) && (event.hold ?? 1) <= 0.2 ? 0.42 : MIN_HOLD[event.kind] ?? 0.4),
      logOnly: logOnly.includes(event.kind)
    }));
    // After a QTE the enemy is already at the point of contact.
    this.armed = fromQte;
    this.beatTimer = 0;
    this.pendingOutcome = result.status;
    this.pendingIncoming = result.incoming;
    this.nextBeat();
  }

  private nextBeat() {
    const beat = this.queue.shift();
    if (!beat) {
      this.onBeatsDone();
      return;
    }
    const ev = beat.event;
    if (beat.logOnly) {
      this.log.record(ev);
      this.nextBeat();
      return;
    }

    // A hit whose strike hasn't been choreographed yet: swing first, land after.
    if (this.isHit(ev) && !beat.armed && !this.armed && !this.isReflect(ev)) {
      const attacker: Side = ev.source ?? (ev.target === 'player' ? 'enemy' : 'player');
      const ms = this.strike(attacker, ev);
      this.queue.unshift({ ...beat, armed: true });
      this.beatTimer = ms / 1000;
      return;
    }
    if (this.isHit(ev)) this.armed = false;

    this.beatTimer = beat.hold;
    this.playBeat(ev);
    this.syncAll();
  }

  private isHit(ev: CombatEvent) {
    return ev.kind === 'damage' || ev.kind === 'crit' || ev.kind === 'block';
  }

  /** Damage that bounced back (thorns, reflect, iron brace) — no lunge for it. */
  private isReflect(ev: CombatEvent) {
    if (this.reflectNext) return true;
    if (this.phase === 'enemy' && ev.target === 'enemy') return true;
    return false;
  }

  /** Starts the attacker's contact attack; returns ms until the blow lands. */
  private strike(attacker: Side, ev: CombatEvent): number {
    if (attacker === 'player') {
      const kind: AttackKind = this.melee ? 'melee' : 'ranged';
      return this.arena.attack('player', kind, { element: this.elementFor(ev), pose: this.rangedPose });
    }
    return this.arena.attack('enemy', 'melee', { element: 'steel' });
  }

  private elementFor(ev: CombatEvent): FxElement {
    if (this.attackElement !== 'steel') return this.attackElement;
    switch (ev.fx) {
      case 'fire': return 'fire';
      case 'frost': return 'frost';
      case 'shadow': return 'void';
      case 'holy': return 'holy';
      case 'arcane': return 'arcane';
      case 'poison': return 'poison';
      default: return 'steel';
    }
  }

  private playBeat(ev: CombatEvent) {
    const ctx = this.ctx;
    const onEnemy = ev.target === 'enemy';
    const label = ev.label ?? (ev.amount != null ? String(Math.round(ev.amount)) : '');
    this.log.record(ev);

    switch (ev.kind) {
      case 'turn':
        this.showBanner(moveLabel(ev.label ?? ev.text), ev.icon, this.enemy.name, true);
        this.arena.pose('enemy', 'charge');
        break;
      case 'action': {
        const isPlayer = ev.source !== 'enemy';
        this.showBanner(ev.label ?? ev.text, ev.icon, isPlayer ? t('common.you') : this.enemy.name, !isPlayer);
        if (isPlayer && ev.target === 'enemy') {
          // An attack: dash in, land on contact. The following hit beat is
          // armed by the beat timer, which now waits exactly until contact.
          const kind: AttackKind = this.melee && !this.isThrown(ev) ? 'melee' : 'ranged';
          const ms = this.arena.attack('player', kind, { element: this.elementFor(ev), pose: this.rangedPose });
          this.armed = true;
          this.beatTimer = ms / 1000;
          ctx.audio.play('swoosh');
        } else if (isPlayer) {
          if (ev.fx === 'guard') {
            this.arena.pose('player', 'defend');
            ctx.audio.play('block');
          } else {
            this.arena.attack('player', 'cast');
            ctx.audio.play('magic');
          }
        } else if (ev.target === 'player' && !this.armed) {
          // Enemy attack outside a QTE (echo, or a non-telegraphed swing).
          const ms = this.arena.attack('enemy', 'melee');
          this.armed = true;
          this.beatTimer = ms / 1000;
          ctx.audio.play('swoosh');
        } else if (!this.armed) {
          this.arena.attack('enemy', 'cast');
          ctx.audio.play('magic');
        }
        break;
      }
      case 'damage':
      case 'crit': {
        const crit = ev.kind === 'crit';
        const reflect = this.isReflect(ev);
        this.reflectNext = false;
        const attacker: Side = ev.target === 'player' ? 'enemy' : 'player';
        this.arena.hit(ev.target);
        this.arena.pose(ev.target, 'hurt');
        if (reflect) {
          this.arena.trail(ev.target, 'metal');
          this.arena.impact(ev.target, 'metal', 0.7);
          this.floatOn(ev.target, `↩ ${label}`, 'damage');
          ctx.audio.play('hit');
          break;
        }
        const element = attacker === 'player' ? this.elementFor(ev) : 'steel';
        this.arena.burst(ev.target, crit ? 'crit' : 'hit');
        this.arena.impact(ev.target, element, crit ? 1.35 : 1);
        this.floatOn(ev.target, crit ? `${label}!` : label || '—', crit ? 'crit' : 'damage');
        ctx.audio.play(crit ? 'crit' : 'hit');
        this.shake(crit ? 9 : 5, crit ? 300 : 220);
        if (crit) this.arena.freeze(70);
        if (!onEnemy) ctx.fx.flash('rgba(255,60,90,0.22)', 200);
        break;
      }
      case 'block':
        this.arena.hit(ev.target);
        this.arena.impact(ev.target, ev.target === 'player' ? this.parryElement : 'metal', 0.8);
        this.floatOn(ev.target, `⛊ ${label}`, 'block');
        this.arena.pose(ev.target, ev.target === 'player' ? 'defend' : 'idle');
        ctx.audio.play('block');
        break;
      case 'parry':
        this.arena.freeze(120);
        this.arena.rimFlash('player');
        this.arena.pose('player', 'defend');
        this.arena.impact('player', this.parryElement, 1.4);
        this.floatOn('player', t('combat.parry_float'), 'parry');
        ctx.audio.play('block');
        this.after(0.12, () => ctx.audio.play('crit'));
        ctx.fx.flash('rgba(200,240,255,0.25)', 220);
        break;
      case 'heal':
        this.arena.burst(ev.target, 'heal');
        this.arena.impact(ev.target, 'holy', 0.6);
        this.floatOn(ev.target, `+${label}`, 'heal');
        ctx.audio.play('heal');
        break;
      case 'shield':
        this.arena.impact(ev.target, ev.target === 'player' ? this.parryElement : 'metal', 0.8);
        this.floatOn(ev.target, `⛊ +${label}`, 'shield');
        ctx.audio.play('block');
        break;
      case 'status':
        this.floatOn(ev.target, `${ev.icon ?? '✦'} ${ev.text}`.trim(), 'status');
        ctx.audio.play('magic');
        break;
      case 'dot':
        this.arena.hit(ev.target);
        this.arena.impact(ev.target, ev.fx === 'burn' ? 'fire' : ev.fx === 'poison' ? 'poison' : 'beast', 0.6);
        this.floatOn(ev.target, `${ev.icon ?? ''} ${label}`.trim(), 'damage');
        ctx.audio.play('hurt');
        break;
      case 'info':
        if (ev.fx === 'reflect' || /^Reflected/.test(ev.text)) this.reflectNext = true;
        this.floatOn(ev.target, `${ev.icon ?? ''} ${ev.text}`.trim(), 'hint');
        break;
      case 'phase':
        this.el.classList.add('is-phase');
        this.after(0.9, () => this.el.classList.remove('is-phase'));
        this.showBanner(ev.text, ev.icon, ev.label ?? t('combat.phase'), true);
        this.shake(12, 600);
        ctx.audio.play('boss');
        ctx.fx.flash('rgba(255,140,60,0.28)', 320);
        ctx.music.setIntensity(1);
        break;
      case 'revive':
        this.arena.revive(ev.target);
        this.showBanner(ev.text, ev.icon, this.enemy.name, true);
        ctx.audio.play('levelup');
        break;
      case 'death':
        this.arena.pose(ev.target, 'dead');
        this.arena.burst(ev.target, 'death');
        ctx.audio.play(ev.target === 'enemy' ? 'victory' : 'defeat');
        break;
      case 'flee':
        ctx.audio.play('ui_back');
        this.floatOn('player', `💨 ${t('combat.away')}`, 'hint');
        break;
      default:
        break;
    }
  }

  private isThrown(ev: CombatEvent) {
    return ev.fx === 'fire' && /bomb|flask|vial/i.test(ev.label ?? '');
  }

  private floatOn(side: Side, text: string, kind: Parameters<GameContext['fx']['float']>[4]) {
    const p = this.arena.anchor(side);
    this.ctx.fx.float(this.el, p.x, p.y, text, kind);
  }

  private shake(amp: number, ms: number) {
    if (this.ctx.state.stats.settings.reducedMotion) return;
    this.ctx.fx.shake(this.el, amp, ms);
  }

  /** The action banner: "GOBLIN — RAKE". Stays up at least 0.9 s. */
  private showBanner(label: string, icon: string | undefined, who: string, foe = false) {
    const b = this.q('.cb-turn-banner');
    (b.querySelector('i') as HTMLElement).textContent = icon ?? '';
    (b.querySelector('u') as HTMLElement).textContent = who;
    (b.querySelector('b') as HTMLElement).textContent = label;
    b.classList.toggle('is-foe', foe);
    b.classList.remove('is-on');
    void b.offsetWidth;
    b.classList.add('is-on');
    this.bannerTimer = 0.9;
  }

  private hideBanner() {
    this.q('.cb-turn-banner').classList.remove('is-on');
    this.bannerTimer = 0;
  }

  private onBeatsDone() {
    this.log.flush();
    const status = this.pendingOutcome;
    if (status === 'awaiting') {
      this.startEnemyPhase();
      return;
    }
    if (status === 'ongoing') {
      this.unlock();
      return;
    }
    if (this.finished) return;
    this.finished = true;
    this.phase = 'over';
    if (status === 'won') this.win();
    else if (status === 'lost') this.lose();
    else this.flee();
  }

  private unlock() {
    this.busy = false;
    this.phase = 'player';
    this.armed = false;
    this.arena.recall('player');
    this.arena.recall('enemy');
    this.arena.pose('player', 'idle');
    this.arena.pose('enemy', 'idle');
    this.syncAll();
  }

  /* ------------------------------------------------------------ enemy turn -- */

  private startEnemyPhase() {
    this.phase = 'enemy';
    this.armed = false;
    const incoming = this.pendingIncoming ?? { attack: this.combat.enemyWillAttack, intent: this.combat.intent };
    this.arena.recall('player');
    this.showBanner(incoming.intent.label, incoming.intent.icon, this.enemy.name, true);
    this.bannerTimer = 99;
    this.arena.pose('enemy', 'charge');

    if (!incoming.attack) {
      // No blow coming: a short read of the banner, then the move resolves.
      this.after(0.7, () => {
        if (this.finished) return;
        const r = this.combat.enemyTurn('none');
        // The banner already says what it is; the 'action' beat plays the cast.
        this.enqueue(r, false, ['turn']);
      });
      return;
    }

    this.after(QTE_BANNER, () => {
      if (this.finished) return;
      this.arena.pose('player', 'defend');
      const ms = this.arena.attack('enemy', 'melee', { approach: QTE_APPROACH });
      this.arena.qteStart(ms / 1000, PARRY_WINDOW);
      this.qte = { t: 0, hitAt: ms / 1000, tapped: false, result: 'none', resolved: false, froze: false };
      this.q('.cb-parry-pad').classList.add('is-on');
      this.ctx.audio.play('swoosh');
    });
  }

  /** One tap counts. Early/late taps lock a miss and say so. */
  onParryTap() {
    const q = this.qte;
    if (!q || q.tapped) return;
    q.tapped = true;
    if (q.resolved) {
      // The blow already landed: no effect, but tell the player they were late.
      this.floatOn('player', t('combat.too_late'), 'hint');
      this.ctx.audio.play('ui_back');
      return;
    }
    const d = q.t - q.hitAt;
    if (Math.abs(d) <= PARRY_WINDOW) {
      q.result = 'perfect';
      this.q('.cb-parry-pad').classList.add('is-hit');
    } else {
      q.result = 'none';
      this.q('.cb-parry-pad').classList.add('is-miss');
      this.floatOn('player', d < 0 ? t('combat.too_early') : t('combat.too_late'), 'hint');
      this.ctx.audio.play('ui_back');
    }
  }

  /** DEV/QA: simulate a tap `offsetSec` from the perfect moment (negative = early). */
  simulateParry(offsetSec = 0) {
    const q = this.qte;
    if (!q) return false;
    q.t = q.hitAt + offsetSec;
    this.onParryTap();
    return q.result;
  }

  private tickQte(dt: number) {
    const q = this.qte;
    if (!q || q.resolved) return;
    q.t += dt;
    // Impact: hold the frame while the tap window closes.
    if (!q.froze && q.t >= q.hitAt) {
      q.froze = true;
      this.arena.freeze(PARRY_WINDOW * 1000);
    }
    const resolveAt = q.hitAt + PARRY_WINDOW;
    if (q.t >= resolveAt || (q.tapped && q.result === 'perfect' && q.t >= q.hitAt)) this.resolveQte();
  }

  private resolveQte() {
    const q = this.qte;
    if (!q || q.resolved) return;
    q.resolved = true;
    const parry: ParryResult = q.result;
    this.arena.qteResolve(parry);
    const pad = this.q('.cb-parry-pad');
    pad.classList.remove('is-on', 'is-hit', 'is-miss');
    this.hideBanner();
    const r = this.combat.enemyTurn(parry);
    this.after(0.35, () => {
      this.arena.qteClear();
      this.qte = null;
    });
    this.enqueue(r, true, ['turn', 'action']);
  }

  /* -------------------------------------------------------------- endings -- */

  private win() {
    const ctx = this.ctx;
    const e = this.enemy;
    ctx.state.stats.battlesWon += 1;
    ctx.music.setMode('victory');
    this.arena.recall('player');
    this.arena.pose('player', 'victory');
    const gold = e.goldReward;
    const xp = e.xpReward;
    const s = this.log.summary;

    const params: RewardParams = {
      title: e.isBoss ? t('combat.win_title_boss', { name: e.name }) : t('combat.win_title'),
      icon: e.isBoss ? '👑' : '⚔️',
      message: e.isBoss ? t('combat.win_msg_boss') : tn('combat.win_msg', Math.max(1, this.combat.turns), { name: e.name }),
      gold,
      xp,
      lootCount: e.isBoss ? 2 : e.isElite ? 1 : Math.random() < 0.55 ? 1 : 0,
      lootRarity: e.guaranteedRarity,
      grantProgress: !e.isBoss,
      bossDefeated: e.isBoss,
      node: this.params.node,
      allowDouble: true,
      combat: {
        outcome: 'won',
        enemyName: e.name,
        enemyIcon: e.icon,
        wasBoss: e.isBoss,
        gold,
        xp,
        turns: this.combat.turns,
        loot: []
      }
    };
    this.endBanner(t('combat.victory'), 'is-win');
    const panel = this.endPanel(`
      <div class="cb-sum">
        ${this.sumCell(t('combat.sum_rounds'), String(Math.max(1, this.combat.turns)))}
        ${this.sumCell(t('combat.sum_dealt'), String(s.dealt), 'is-you')}
        ${this.sumCell(t('combat.sum_taken'), String(s.taken), 'is-bad')}
        ${this.sumCell(t('combat.sum_parries'), String(s.parries), 'is-parry')}
      </div>`);
    const go = document.createElement('button');
    go.className = 'btn btn-gold btn-block';
    go.innerHTML = `${esc(t('combat.collect'))} <i>▸</i>`;
    go.addEventListener('click', () => {
      ctx.audio.play('ui_tap');
      ctx.goto('reward', params);
    });
    panel.appendChild(this.logButton());
    panel.appendChild(go);
    this.after(0.6, () => panel.classList.add('is-on'));
  }

  private sumCell(label: string, value: string, cls = '') {
    return `<div class="cb-sum-cell ${cls}"><b>${value}</b><u>${esc(label)}</u></div>`;
  }

  private lose() {
    const ctx = this.ctx;
    ctx.music.setMode('defeat');
    this.endBanner(t('combat.defeated'), 'is-lose');
    const lost = Math.round(ctx.state.stats.gold * 0.25);
    const boss = this.enemy.isBoss;

    const panel = this.endPanel(`
      <p class="cb-end-line">${esc(t('combat.lose_line', { name: this.enemy.name }))}</p>
      ${boss ? `<p class="cb-end-line cb-end-warn">${esc(t('combat.lose_boss', { name: this.enemy.name }))}</p>` : ''}
      <p class="cb-end-cost">−${lost} 🪙</p>`);

    const revive = document.createElement('button');
    revive.className = 'btn btn-gold btn-block cb-revive';
    revive.innerHTML = `<i>📺</i> ${esc(t('combat.second_wind'))} <u>${esc(t('combat.watch_ad'))}</u>`;
    revive.addEventListener('click', () => {
      ctx.audio.play('levelup');
      ctx.toast(t('combat.ad_placeholder'), 'info');
      ctx.state.stats.hp = Math.max(1, Math.round(ctx.state.maxHp * 0.6));
      this.enemy.hp = Math.max(1, Math.round(this.enemy.hp * 0.5));
      ctx.save();
      this.resume();
    });

    const give = document.createElement('button');
    give.className = 'btn btn-ghost btn-block';
    give.textContent = boss ? t('combat.limp_back_boss') : t('combat.limp_back');
    give.addEventListener('click', () => {
      ctx.audio.play('ui_back');
      ctx.state.stats.gold = Math.max(0, ctx.state.stats.gold - lost);
      ctx.state.stats.hp = Math.max(1, Math.round(ctx.state.maxHp * 0.4));
      if (boss) {
        ctx.state.onBossLost();
        ctx.toast(t('combat.road_resets'), 'bad');
      }
      ctx.save();
      ctx.goto('run');
    });

    panel.appendChild(revive);
    panel.appendChild(this.logButton());
    panel.appendChild(give);
    this.after(0.35, () => panel.classList.add('is-on'));
  }

  private flee() {
    const ctx = this.ctx;
    this.endBanner(t('combat.escaped'), 'is-flee');
    ctx.save();
    const panel = this.endPanel(`<p class="cb-end-line">${esc(t('combat.flee_line'))}</p>`);
    const go = document.createElement('button');
    go.className = 'btn btn-primary btn-block';
    go.textContent = t('combat.back_to_road');
    go.addEventListener('click', () => {
      ctx.audio.play('ui_tap');
      ctx.goto('run');
    });
    panel.appendChild(this.logButton());
    panel.appendChild(go);
    this.after(0.35, () => panel.classList.add('is-on'));
  }

  private logButton(): HTMLElement {
    const b = document.createElement('button');
    b.className = 'btn btn-ghost btn-block cb-end-log';
    b.innerHTML = `📜 ${esc(t('combat.fight_log'))} <u>${esc(tn('combat.log_entries', this.log.lines.filter(l => l.tone !== 'round').length))}</u>`;
    b.addEventListener('click', () => {
      this.ctx.audio.play('ui_tap');
      this.openLog();
    });
    return b;
  }

  private endPanel(html: string): HTMLElement {
    const host = this.q('.cb-end');
    const panel = document.createElement('div');
    panel.className = 'cb-end-panel panel';
    panel.innerHTML = `<div class="panel-bd">${html}</div>`;
    host.appendChild(panel);
    return panel;
  }

  /** Continues the fight after a revive. */
  private resume() {
    const ctx = this.ctx;
    this.finished = false;
    this.phase = 'player';
    this.pendingOutcome = 'ongoing';
    this.pendingIncoming = undefined;
    this.queue = [];
    this.qte = null;
    this.armed = false;
    this.combat.resume();
    this.el.classList.remove('is-over', 'is-win', 'is-lose', 'is-flee');
    this.q('.cb-end').innerHTML = '';
    this.arena.revive('player');
    this.arena.recall('enemy');
    this.arena.pose('enemy', 'idle');
    ctx.music.setMode(this.enemy.isBoss ? 'boss' : 'combat');
    this.log.note(t('combat.second_wind_log', { hp: ctx.state.stats.hp, name: this.enemy.name, ehp: this.enemy.hp }), 'good', '🌿');
    this.showBanner(t('combat.second_wind'), '🌿', t('common.you'));
    this.busy = true;
    this.syncAll();
    this.after(1.0, () => this.unlock());
  }

  private endBanner(text: string, cls: string) {
    this.hideBanner();
    this.el.classList.add('is-over', cls);
    const host = this.q('.cb-end');
    const b = document.createElement('div');
    b.className = 'cb-end-banner';
    b.textContent = text;
    host.appendChild(b);
    requestAnimationFrame(() => b.classList.add('is-on'));
  }

  private after(seconds: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, seconds * 1000));
  }

  /* --------------------------------------------------------------- sheets -- */

  /** One sheet at a time, always over the end panel. */
  private openSheet(
    title: string,
    build: (body: HTMLElement) => void,
    opts: { cls?: string; onClose?: () => void } = {}
  ): HTMLElement {
    this.sheetClose?.();
    const scrim = document.createElement('div');
    scrim.className = `sheet-scrim cb-sheet-scrim ${opts.cls ?? ''}`;
    const sheet = document.createElement('div');
    sheet.className = 'sheet cb-sheet';
    sheet.innerHTML = `
      <div class="sheet-hd"><b>${esc(title)}</b><button class="icon-btn cb-sheet-close" aria-label="${esc(t('common.close'))}">✕</button></div>
      <div class="sheet-bd"></div>`;
    const body = sheet.querySelector('.sheet-bd') as HTMLElement;
    build(body);
    scrim.appendChild(sheet);
    const close = () => {
      scrim.classList.remove('is-open');
      window.setTimeout(() => scrim.remove(), 300);
      if (this.sheetClose === close) this.sheetClose = null;
      this.logSheetBody = null;
      opts.onClose?.();
    };
    scrim.addEventListener('click', e => {
      if (e.target === scrim) close();
    });
    (sheet.querySelector('.cb-sheet-close') as HTMLElement).addEventListener('click', close);
    this.el.appendChild(scrim);
    requestAnimationFrame(() => scrim.classList.add('is-open'));
    this.sheetClose = close;
    return body;
  }

  private openItems() {
    const state = this.ctx.state;
    const owned = combatConsumables().filter(c => state.consumableCount(c.id) > 0);
    this.busy = true;
    this.syncActions();
    let used = false;
    this.openSheet(
      t('combat.satchel'),
      body => {
        if (!owned.length) {
          body.innerHTML = `<p class="cb-empty">${esc(t('combat.satchel_empty'))}</p>`;
        }
        for (const c of owned) {
          const b = document.createElement('button');
          b.className = 'btn btn-ghost btn-block cb-item-row';
          b.innerHTML = `<i>${c.icon}</i><span><b>${esc(cname('consumable', c.id, c.name))}</b><u>${esc(cdesc('consumable', c.id, c.description))}</u></span><em>×${state.consumableCount(c.id)}</em>`;
          b.addEventListener('click', () => {
            used = true;
            this.sheetClose?.();
            this.busy = false;
            this.take({ type: 'item', id: c.id });
          });
          body.appendChild(b);
        }
      },
      {
        onClose: () => {
          if (!used && !this.finished) {
            this.busy = false;
            this.syncActions();
          }
        }
      }
    );
  }

  openLog() {
    this.openSheet(
      t('combat.fight_log'),
      body => {
        this.logSheetBody = body;
        this.renderLog(body);
      },
      { cls: 'cb-log-scrim' }
    );
  }

  private renderLog(body: HTMLElement) {
    body.innerHTML = '';
    if (!this.log.lines.length) {
      body.innerHTML = `<p class="cb-empty">${esc(t('combat.log_empty'))}</p>`;
      return;
    }
    let group: HTMLElement | null = null;
    for (const line of this.log.lines) {
      if (line.tone === 'round') {
        group = document.createElement('div');
        group.className = 'cb-log-round';
        group.innerHTML = `<h4>${esc(line.text)}</h4>`;
        body.appendChild(group);
        continue;
      }
      if (!group) {
        group = document.createElement('div');
        group.className = 'cb-log-round';
        body.appendChild(group);
      }
      group.appendChild(this.logLineEl(line));
    }
    body.scrollTop = body.scrollHeight;
  }

  private logLineEl(line: LogLine): HTMLElement {
    const row = document.createElement('div');
    row.className = `cb-log-line is-${line.tone}`;
    row.innerHTML = `<i>${line.icon ?? ''}</i><span>${esc(line.text)}</span>`;
    return row;
  }

  private onLogChange() {
    const last = this.log.last;
    const strip = this.q('.cb-strip-text');
    if (last && last.tone !== 'round') {
      strip.textContent = `${last.icon ? `${last.icon} ` : ''}${last.text}`;
      strip.className = `cb-strip-text is-${last.tone}`;
      const host = this.q('.cb-strip');
      host.classList.remove('is-new');
      void host.offsetWidth;
      host.classList.add('is-new');
    }
    if (this.logSheetBody) this.renderLog(this.logSheetBody);
  }

  private openBossInfo() {
    const c = this.combat;
    const e = this.enemy;
    this.openSheet(e.name, body => {
      const parts: string[] = [];
      if (e.title) parts.push(`<p class="cb-info-title">${esc(e.title)}</p>`);
      const passive = c.passiveInfo;
      if (passive && c.passive) {
        parts.push(`<div class="cb-info-block"><h4>${esc(t('combat.passive'))}</h4><div class="cb-info-row"><i>${passive.icon}</i><span><b>${esc(cname('passive', c.passive, passive.name))}</b><u>${esc(cdesc('passive', c.passive, passive.description))}</u></span></div></div>`);
      }
      if (e.ability) {
        const icon = { lifesteal: '🧛', reflect: '🌵', enrage: '😤' }[e.ability];
        parts.push(`<div class="cb-info-block"><h4>${esc(t('combat.trait'))}</h4><div class="cb-info-row"><i>${icon}</i><span><b>${esc(t(`combat.trait_${e.ability}`))}</b><u>${esc(t(`combat.trait_${e.ability}_desc`))}</u></span></div></div>`);
      }
      if (c.phases.length > 1) {
        const rows = c.phases
          .map((p, i) => {
            const at = i === 0 ? t('combat.from_start') : t('combat.below_hp', { n: Math.round(p.at * 100) });
            const moves = p.moves.map(m => `${m.icon} ${esc(moveLabel(m.label))}`).join(' · ');
            const cur = i === c.phaseIndex ? ' is-now' : i < c.phaseIndex ? ' is-past' : '';
            return `<div class="cb-info-row cb-phase-row${cur}"><i>${i + 1}</i><span><b>${esc(phaseName(e.id, i, p.name))} <em>${esc(at)}</em></b><u>${moves}</u></span></div>`;
          })
          .join('');
        parts.push(`<div class="cb-info-block"><h4>${esc(t('combat.phases'))}</h4>${rows}</div>`);
      }
      if (!e.isBoss) {
        parts.push(`<p class="cb-info-title">${esc(e.isElite ? t('combat.elite_note') : t('combat.common_note'))}</p>`);
      }
      body.innerHTML = parts.join('');
    });
  }

  /* ----------------------------------------------------------------- sync -- */

  private syncAll() {
    const c = this.combat;
    const st = this.ctx.state;

    // Enemy. Bars show the engine value minus whatever the beat queue still
    // has to land, so the HP drops when the blow connects, not when it's rolled.
    const ehp = Math.max(0, Math.min(this.enemy.maxHp, c.enemyHp + this.pendingHp('enemy')));
    this.foeBar.set(ehp / Math.max(1, this.enemy.maxHp));
    this.q('.cb-enemy-hp-txt').textContent = `${ehp} / ${this.enemy.maxHp}`;
    this.shieldOverlay(this.q('.cb-enemy-hp .cb-shield'), this.q('.cb-enemy-shield-txt'), Math.max(0, c.enemyShield + this.pendingShield('enemy')), this.enemy.maxHp);

    const threat = c.threat();
    const chip = this.q('.cb-threat');
    chip.textContent = t(`combat.threat_${threat.level}`);
    chip.className = `cb-threat chip threat-${threat.level}`;

    this.q('.cb-phase').textContent = c.phaseName ? `— ${phaseName(this.enemy.id, c.phaseIndex, c.phaseName)} —` : '';

    // Intent
    const intent = c.intent;
    this.q('.cb-intent-icon').textContent = intent.icon;
    this.q('.cb-intent-label').textContent = intent.label;
    const dmg = c.intentDamage();
    this.q('.cb-intent-sub').textContent = dmg > 0 ? t('combat.about_damage', { n: dmg }) : c.passive && c.passiveInfo ? cname('passive', c.passive, c.passiveInfo.name) : '';
    this.el.classList.toggle('is-threatened', dmg > 0 && dmg >= st.stats.hp);

    // Player
    const maxHp = st.maxHp;
    const hp = Math.max(0, Math.min(maxHp, st.stats.hp + this.pendingHp('player')));
    this.hpBar.set(hp / Math.max(1, maxHp));
    this.q('.cb-hero-hp-txt').textContent = `${hp} / ${maxHp}`;
    this.shieldOverlay(this.q('.cb-hero-hp .cb-shield'), this.q('.cb-hero-shield-txt'), Math.max(0, c.playerShield + this.pendingShield('player')), maxHp);
    const pips = Array.from(this.q('.cb-pips').children);
    pips.forEach((p, i) => p.classList.toggle('is-on', i < c.energy));
    this.q('.cb-energy-txt').textContent = `${c.energy}/10`;

    this.renderStatuses(this.q('.cb-status-enemy'), c.enemyStatuses);
    this.renderStatuses(this.q('.cb-status-hero'), c.playerStatuses);

    // Music tension: low HP and boss phases wind it up.
    const hpFrac = st.stats.hp / Math.max(1, maxHp);
    this.ctx.music.setIntensity(Math.min(1, (1 - hpFrac) * 0.75 + c.phaseIndex * 0.2));

    this.syncActions();
  }

  /**
   * HP the queue still owes `side`: damage not yet shown is added back, heals
   * not yet shown are taken away. Shield absorption is ignored (it snaps when
   * the batch ends), which keeps the maths honest enough to read.
   */
  private pendingHp(side: Side): number {
    let d = 0;
    for (const b of this.queue) {
      const ev = b.event;
      if (ev.target !== side || ev.amount == null) continue;
      if (ev.kind === 'damage' || ev.kind === 'crit' || ev.kind === 'dot') d += ev.amount;
      else if (ev.kind === 'heal') d -= ev.amount;
    }
    return Math.round(d);
  }

  private pendingShield(side: Side): number {
    let d = 0;
    for (const b of this.queue) {
      const ev = b.event;
      if (ev.target !== side || ev.amount == null) continue;
      if (ev.kind === 'shield') d -= ev.amount;
      else if (ev.kind === 'block') d += ev.amount;
    }
    return Math.round(d);
  }

  private shieldOverlay(bar: HTMLElement, txt: HTMLElement, shield: number, maxHp: number) {
    bar.style.width = `${Math.min(100, (shield / Math.max(1, maxHp)) * 100)}%`;
    bar.classList.toggle('is-on', shield > 0);
    txt.textContent = shield > 0 ? `⛊ ${shield}` : '';
    txt.classList.toggle('is-on', shield > 0);
  }

  private renderStatuses(host: HTMLElement, list: StatusEffect[]) {
    host.innerHTML = '';
    for (const s of list) {
      const info = STATUS_INFO[s.id];
      if (!info) continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `cb-st ${info.harmful ? 'is-bad' : 'is-good'}`;
      chip.style.setProperty('--st', info.color);
      chip.innerHTML = `<i>${info.icon}</i><b>${s.stacks}</b><u>${esc(t('common.turns_short', { n: s.turns }))}</u>`;
      chip.title = t('combat.status_title', { name: statusName(s.id), desc: statusDesc(s.id) });
      chip.addEventListener('click', e => {
        e.stopPropagation();
        this.ctx.toast(t('combat.status_tip', { icon: info.icon, name: statusName(s.id), stacks: s.stacks, turns: tn('common.turns', s.turns), desc: statusDesc(s.id) }));
      });
      host.appendChild(chip);
    }
  }

  private syncActions() {
    const c = this.combat;
    const locked = this.busy || this.finished;
    for (const node of Array.from(this.el.querySelectorAll<HTMLButtonElement>('.cb-act, .cb-minor .btn'))) {
      node.classList.toggle('is-locked', locked);
      node.disabled = locked;
    }
    for (const ability of c.abilities) {
      const btn = this.el.querySelector<HTMLButtonElement>(`[data-ability="${ability.id}"]`);
      if (!btn) continue;
      const cd = c.cooldowns[ability.id] ?? 0;
      const poor = c.energy < c.costOf(ability);
      btn.classList.toggle('is-cooling', cd > 0);
      btn.classList.toggle('is-poor', poor && cd <= 0);
      (btn.querySelector('.cb-cd') as HTMLElement).textContent = cd > 0 ? String(cd) : '';
      if (!locked) btn.disabled = cd > 0 || poor;
    }
  }

  /* --------------------------------------------------------------- update -- */

  update(dt: number) {
    // Hit-stop: the whole battlefield holds, particles included.
    if (!this.arena.isFrozen) this.ctx.fx.update(dt);
    this.arena.update(dt);
    this.arena.draw();

    if (this.bannerTimer > 0 && this.bannerTimer < 90) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.hideBanner();
    }

    if (this.qte && !this.qte.resolved) {
      this.tickQte(dt);
      return;
    }

    if (this.beatTimer > 0) {
      this.beatTimer -= dt;
      if (this.beatTimer <= 0) this.nextBeat();
    }
  }
}

/* ------------------------------------------------------------------ utils -- */

function esc(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

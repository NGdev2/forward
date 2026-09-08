import type { GameContext } from '../../core/context';
import type { CreaturePose, FxElement, HeroPose } from '../../render/api';
import { lookFromEquipment } from '../../render/api';
import type { EnemyInstance } from '../../game/types';
import { creatureExtent } from '../../render/sprites';
import { ELEMENT_COLORS } from '../../render/fx';
import { biomeFor, type Biome } from '../run/biomes';

/* ============================================================================
 * The battlefield canvas: a lit clearing beside the road, hero on the left,
 * the thing that stopped you on the right. Same biome palette as the run
 * screen, so a fight reads as happening *where you were*, not in a void.
 *
 * The screen tells the arena what happens ("hero attacks with a melee weapon",
 * "enemy is hurt") and the arena owns the choreography — most importantly the
 * CONTACT ATTACK: the attacker dashes from his mark to just in front of the
 * target, the swing frame lands on arrival, and `attack()` returns the number
 * of milliseconds until that contact so the screen can sync the damage beat.
 * ========================================================================== */

export type Side = 'player' | 'enemy';
export type AttackKind = 'melee' | 'ranged' | 'cast';

export interface AttackOpts {
  /** Element for the projectile / swing trail. */
  element?: FxElement;
  /** Seconds the approach takes. Default: as long as the wind-up. */
  approach?: number;
  /** Ranged attacks: draw the bow ('attack') or channel a bolt ('cast'). */
  pose?: 'attack' | 'cast';
}

interface Tween {
  from: number;
  to: number;
  t: number;
  dur: number;
}

interface AttackState {
  kind: AttackKind;
  element: FxElement;
  /** Seconds since the attack started. */
  t: number;
  /** When the swing pose starts relative to attack start (may be negative). */
  swingStart: number;
  /** Seconds after start when the hit lands. */
  contactAt: number;
  /** Set once we've passed contact for the current swing. */
  landed: boolean;
  /** Projectile launched for ranged attacks. */
  shot: boolean;
  /** True once the retreat has been triggered. */
  retreating: boolean;
}

interface Actor {
  pose: string;
  /** Local time in the current pose, so cycles start at their first frame. */
  poseT: number;
  poseLeft: number;
  flash: number;
  rim: number;
  alpha: number;
  dead: boolean;
  /** Horizontal offset from the home mark, px. */
  off: number;
  move: Tween | null;
  atk: AttackState | null;
}

interface Projectile {
  x: number;
  y: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
  dur: number;
  element: FxElement;
  side: Side;
}

interface Qte {
  t: number;
  dur: number;
  window: number;
  result: 'pending' | 'perfect' | 'none';
  /** Seconds since resolved, for the post flash. */
  since: number;
}

const DEFAULT_HOLD = 0.5;
/** Swing-cycle length and the moment inside it where the blow lands. */
const HERO_CYCLE = 0.72;
const HERO_SWING = 0.36;
const FOE_CYCLE = 0.8;
const FOE_SWING = 0.4;
const RETREAT = 0.3;
/** How long an attacker stays at contact after landing, so multi-hit moves re-strike in place. */
const LINGER = 0.5;
const RANGED_RELEASE = 0.22;
const RANGED_FLIGHT = 0.28;

function easeOut(k: number) {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);
}

function newActor(): Actor {
  return { pose: 'idle', poseT: 0, poseLeft: 999, flash: 0, rim: 0, alpha: 1, dead: false, off: 0, move: null, atk: null };
}

export class CombatArena {
  private c: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private t = 0;
  private biome: Biome;
  private frozen = 0;
  private reduced = false;

  private hero: Actor = newActor();
  private foe: Actor = newActor();
  private shots: Projectile[] = [];
  private qte: Qte | null = null;

  /** Offscreen buffer for the parry rim light. */
  private rimCanvas: HTMLCanvasElement | null = null;

  /** Parallax dressing, generated once so the clearing has a fixed identity. */
  private props: { x: number; y: number; s: number; kind: number }[] = [];
  private motes: { x: number; y: number; vx: number; vy: number; r: number }[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: GameContext,
    private enemy: EnemyInstance
  ) {
    this.c = canvas.getContext('2d')!;
    this.biome = biomeFor(ctx.state.stats.worldCycle);
    this.reduced = !!ctx.state.stats.settings.reducedMotion;
    const rnd = mulberry(hashId(enemy.id));
    for (let i = 0; i < 9; i++) {
      this.props.push({ x: rnd(), y: 0.55 + rnd() * 0.25, s: 0.5 + rnd() * 0.9, kind: Math.floor(rnd() * 3) });
    }
    for (let i = 0; i < 26; i++) {
      this.motes.push({ x: rnd(), y: rnd(), vx: (rnd() - 0.5) * 0.02, vy: -0.006 - rnd() * 0.02, r: 0.6 + rnd() * 1.6 });
    }
  }

  /* ------------------------------------------------------------- geometry -- */

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.rimCanvas = null;
  }

  /** Ground line the fighters stand on. */
  private get groundY() {
    return this.h * 0.74;
  }

  /** Home marks — where each fighter stands when nothing is happening. */
  private homeOf(side: Side) {
    return side === 'player'
      ? { x: this.w * 0.2, y: this.groundY + this.h * 0.035 }
      : { x: this.w * 0.68, y: this.groundY };
  }

  /** Current feet position including any dash offset. */
  private posOf(side: Side) {
    const home = this.homeOf(side);
    const a = side === 'player' ? this.hero : this.foe;
    return { x: home.x + a.off, y: home.y };
  }

  private get heroScale() {
    return (this.h / 100) * 0.25;
  }

  private get foeScale() {
    // `scale` 1 == 100px of painted silhouette, so the height budget is a
    // plain fraction of the arena. Long, low creatures (boars, serpents) are
    // then scaled down again so they never crowd the hero out of his own half.
    const ext = creatureExtent(this.enemy.id);
    const aspect = ext.width / ext.height;
    const byHeight = (this.h / 100) * (this.enemy.isBoss ? 0.40 : this.enemy.isElite ? 0.32 : 0.27);
    const byWidth = (this.w * (this.enemy.isBoss ? 0.66 : 0.56)) / (100 * aspect);
    return Math.min(byHeight, byWidth);
  }

  /** Painted half-width of a fighter in px. */
  private halfWidth(side: Side) {
    if (side === 'player') return this.heroScale * 100 * 0.33;
    const ext = creatureExtent(this.enemy.id);
    return ((ext.width / ext.height) * 100 * this.foeScale) / 2;
  }

  /** Body height in px (feet to crown). */
  private bodyHeight(side: Side) {
    return side === 'player' ? this.heroScale * 100 : this.foeScale * 100;
  }

  /** Where an attacker's feet stop when striking `target` in melee. */
  private contactX(attacker: Side): number {
    const target: Side = attacker === 'player' ? 'enemy' : 'player';
    const tp = this.posOf(target);
    const reach = this.halfWidth(target) + this.halfWidth(attacker) * 0.55;
    return attacker === 'player' ? tp.x - reach : tp.x + reach;
  }

  /**
   * Where floating numbers should appear. The canvas fills the screen root the
   * floats are parented to, so canvas coordinates are already the right ones.
   */
  anchor(side: Side): { x: number; y: number } {
    const p = this.posOf(side);
    return { x: p.x, y: p.y - this.bodyHeight(side) * (side === 'player' ? 0.72 : 0.78) };
  }

  /** Centre of mass — where impacts and trails land. */
  centre(side: Side): { x: number; y: number } {
    const p = this.posOf(side);
    return { x: p.x, y: p.y - this.bodyHeight(side) * 0.5 };
  }

  /** The attacker's weapon hand, roughly — trails start here. */
  private handOf(side: Side): { x: number; y: number } {
    const p = this.posOf(side);
    const dir = side === 'player' ? 1 : -1;
    return { x: p.x + dir * this.halfWidth(side) * 0.7, y: p.y - this.bodyHeight(side) * 0.55 };
  }

  /* ---------------------------------------------------------------- input -- */

  pose(side: Side, pose: HeroPose | CreaturePose | 'dead') {
    const a = side === 'player' ? this.hero : this.foe;
    if (a.dead) return;
    if (pose === 'dead') {
      a.dead = true;
      a.pose = 'dead';
      a.poseT = 0;
      a.poseLeft = 999;
      a.atk = null;
      a.move = { from: a.off, to: 0, t: 0, dur: 0.25 };
      return;
    }
    if (a.pose !== pose) a.poseT = 0;
    a.pose = pose;
    a.poseLeft = pose === 'idle' || pose === 'run' || pose === 'victory' || pose === 'defend' ? 999 : DEFAULT_HOLD;
  }

  /** Brings a fallen fighter back: clears death, restores alpha, plays a rise. */
  revive(side: Side) {
    const a = side === 'player' ? this.hero : this.foe;
    a.dead = false;
    a.alpha = 1;
    a.flash = 0;
    a.off = 0;
    a.move = null;
    a.atk = null;
    a.pose = 'hurt';
    a.poseT = 0;
    a.poseLeft = 0.45;
    const p = this.centre(side);
    this.ctx.fx.burst(p.x, p.y, 'levelup');
    this.ctx.fx.impact(p.x, p.y, 'holy', { scale: 1.2 });
  }

  /**
   * Starts an attack and returns the milliseconds until contact — the moment
   * the screen should play the damage beat. Calling it again while the
   * attacker is still at the contact point re-swings in place (multi-hit).
   */
  attack(side: Side, kind: AttackKind, opts: AttackOpts = {}): number {
    const a = side === 'player' ? this.hero : this.foe;
    if (a.dead) return 0;
    const element = opts.element ?? 'steel';
    const swing = side === 'player' ? HERO_SWING : FOE_SWING;
    const inPlace = a.atk && !a.atk.retreating && a.atk.kind === 'melee' && kind === 'melee';

    if (kind === 'cast') {
      a.atk = { kind, element, t: 0, swingStart: 0, contactAt: 0.3, landed: false, shot: false, retreating: false };
      this.setPose(a, side === 'player' ? 'cast' : 'charge', 0.7);
      return 300;
    }

    if (kind === 'ranged') {
      a.atk = { kind, element, t: 0, swingStart: 0, contactAt: RANGED_RELEASE + RANGED_FLIGHT, landed: false, shot: false, retreating: false };
      this.setPose(a, side === 'player' ? opts.pose ?? 'attack' : 'attack', 999);
      return Math.round((RANGED_RELEASE + RANGED_FLIGHT) * 1000);
    }

    if (inPlace && a.atk) {
      // Re-strike where we stand: skip half the wind-up so a flurry keeps
      // its rhythm instead of re-cocking the whole swing every hit.
      const skip = swing * 0.5;
      a.atk.t = 0;
      a.atk.swingStart = -skip;
      a.atk.contactAt = swing - skip;
      a.atk.landed = false;
      a.move = null;
      this.setPose(a, 'attack', 999);
      a.poseT = skip;
      return Math.round((swing - skip) * 1000);
    }

    const approach = this.reduced ? Math.min(opts.approach ?? swing, swing) : opts.approach ?? swing;
    const home = this.homeOf(side);
    const to = this.contactX(side) - home.x;
    a.move = { from: a.off, to, t: 0, dur: approach };
    a.atk = {
      kind,
      element,
      t: 0,
      swingStart: approach - swing,
      contactAt: approach,
      landed: false,
      shot: false,
      retreating: false
    };
    // Before the swing starts we're closing distance: a run for the hero, a
    // tensed charge for the creature. If the approach is shorter than the
    // wind-up, start mid-wind-up so the blow still lands on arrival.
    if (a.atk.swingStart > 0) {
      this.setPose(a, side === 'player' ? 'run' : 'charge', 999);
    } else {
      this.setPose(a, 'attack', 999);
      a.poseT = -a.atk.swingStart;
    }
    return Math.round(approach * 1000);
  }

  /** Aborts an in-progress attack and walks the fighter home. */
  recall(side: Side) {
    const a = side === 'player' ? this.hero : this.foe;
    if (a.atk) a.atk.retreating = true;
    a.atk = null;
    if (a.off !== 0) a.move = { from: a.off, to: 0, t: 0, dur: RETREAT };
    // Only attack poses are cancelled; a braced guard or a victory stance stays.
    if (!a.dead && (a.pose === 'attack' || a.pose === 'run' || a.pose === 'cast' || a.pose === 'charge')) this.setPose(a, 'idle', 999);
  }

  private setPose(a: Actor, pose: string, hold: number) {
    if (a.dead) return;
    a.pose = pose;
    a.poseT = 0;
    a.poseLeft = hold;
  }

  hit(side: Side) {
    const a = side === 'player' ? this.hero : this.foe;
    a.flash = 1;
  }

  /** White rim light — the perfect-parry tell. */
  rimFlash(side: Side) {
    const a = side === 'player' ? this.hero : this.foe;
    a.rim = 1;
  }

  /** Hit-stop: everything on the canvas holds for `ms`. */
  freeze(ms: number) {
    if (this.reduced) return;
    this.frozen = Math.max(this.frozen, ms / 1000);
  }

  get isFrozen() {
    return this.frozen > 0;
  }

  burst(side: Side, kind: Parameters<GameContext['fx']['burst']>[2]) {
    const p = this.centre(side);
    this.ctx.fx.burst(p.x, p.y, kind);
  }

  /** Elemental impact on a fighter's body. */
  impact(side: Side, element: FxElement, scale = 1) {
    const p = this.centre(side);
    this.ctx.fx.impact(p.x, p.y, element, { scale });
  }

  /** Elemental streak from the attacker's hand to the target's body. */
  trail(from: Side, element: FxElement) {
    const a = this.handOf(from);
    const b = this.centre(from === 'player' ? 'enemy' : 'player');
    this.ctx.fx.trail(a.x, a.y, b.x, b.y, element);
  }

  /* ------------------------------------------------------------------ qte -- */

  /** Starts the parry timing ring: closes on the hero over `durSec`. */
  qteStart(durSec: number, windowSec: number) {
    this.qte = { t: 0, dur: durSec, window: windowSec, result: 'pending', since: 0 };
  }

  qteResolve(result: 'perfect' | 'none') {
    if (!this.qte) return;
    this.qte.result = result;
    this.qte.since = 0;
  }

  qteClear() {
    this.qte = null;
  }

  /* --------------------------------------------------------------- update -- */

  update(dt: number) {
    if (this.frozen > 0) {
      this.frozen -= dt;
      // Keep the qte clock honest through a freeze so timing never drifts.
      return;
    }
    this.t += dt;
    for (const side of ['player', 'enemy'] as Side[]) {
      const a = side === 'player' ? this.hero : this.foe;
      a.flash = Math.max(0, a.flash - dt * 4.5);
      a.rim = Math.max(0, a.rim - dt * 4);
      a.poseT += dt;
      if (a.poseLeft < 900) {
        a.poseLeft -= dt;
        if (a.poseLeft <= 0) this.setPose(a, 'idle', 999);
      }
      if (a.dead) a.alpha = Math.max(0.12, a.alpha - dt * 0.7);

      if (a.move) {
        a.move.t += dt;
        const k = easeOut(a.move.t / a.move.dur);
        a.off = a.move.from + (a.move.to - a.move.from) * k;
        if (a.move.t >= a.move.dur) {
          a.off = a.move.to;
          a.move = null;
        }
      }

      if (a.atk) this.updateAttack(side, a, dt);
    }

    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const px = s.x;
      const py = s.y;
      s.x = s.x0 + (s.x1 - s.x0) * k;
      s.y = s.y0 + (s.y1 - s.y0) * k - Math.sin(k * Math.PI) * 18;
      this.ctx.fx.trail(px, py, s.x, s.y, s.element);
      if (k >= 1) this.shots.splice(i, 1);
    }

    if (this.qte) {
      if (this.qte.result === 'pending') this.qte.t += dt;
      else this.qte.since += dt;
    }

    for (const m of this.motes) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.y < -0.05) {
        m.y = 1.05;
        m.x = Math.random();
      }
    }
  }

  private updateAttack(side: Side, a: Actor, dt: number) {
    const atk = a.atk!;
    const prev = atk.t;
    atk.t += dt;
    const cycle = side === 'player' ? HERO_CYCLE : FOE_CYCLE;

    if (atk.kind === 'melee') {
      // Swing pose starts when the approach hands over.
      if (a.pose !== 'attack' && prev < atk.swingStart && atk.t >= atk.swingStart && !atk.retreating) {
        this.setPose(a, 'attack', 999);
        a.poseT = atk.t - atk.swingStart;
      }
      if (!atk.landed && atk.t >= atk.contactAt) {
        atk.landed = true;
        this.trail(side, atk.element);
      }
      // Follow-through done, a beat of linger for a re-strike, then back off.
      if (!atk.retreating && atk.landed && atk.t >= Math.max(atk.swingStart + cycle, atk.contactAt + LINGER)) {
        atk.retreating = true;
        a.move = { from: a.off, to: 0, t: 0, dur: RETREAT };
        this.setPose(a, 'idle', 999);
      }
      if (atk.retreating && !a.move) a.atk = null;
      return;
    }

    if (atk.kind === 'ranged') {
      if (!atk.shot && atk.t >= RANGED_RELEASE) {
        atk.shot = true;
        const from = this.handOf(side);
        const to = this.centre(side === 'player' ? 'enemy' : 'player');
        this.shots.push({ x: from.x, y: from.y, x0: from.x, y0: from.y, x1: to.x, y1: to.y, t: 0, dur: RANGED_FLIGHT, element: atk.element, side });
      }
      if (atk.t >= cycle) {
        a.atk = null;
        this.setPose(a, 'idle', 999);
      }
      return;
    }

    if (atk.t >= 0.7) a.atk = null;
  }

  /* ----------------------------------------------------------------- draw -- */

  draw() {
    const c = this.c;
    const { w, h } = this;
    c.clearRect(0, 0, w, h);
    this.drawSky();
    this.drawHills('far');
    this.drawProps();
    this.drawHills('near');
    this.drawGround();
    this.drawBacklight();
    this.drawQte();
    this.drawFighters();
    this.drawShots();
    this.drawMotes();
    this.ctx.fx.draw(c);
  }

  private drawSky() {
    const c = this.c;
    const b = this.biome;
    const g = c.createLinearGradient(0, 0, 0, this.groundY);
    g.addColorStop(0, b.skyTop);
    g.addColorStop(1, b.skyBottom);
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.groundY + 2);

    if (b.stars) {
      c.fillStyle = 'rgba(255,255,255,0.65)';
      for (let i = 0; i < 40; i++) {
        const x = ((i * 97.13) % 100) / 100;
        const y = ((i * 53.71) % 55) / 100;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(this.t * 1.2 + i));
        c.globalAlpha = tw * 0.7;
        c.fillRect(x * this.w, y * this.groundY, 1.4, 1.4);
      }
      c.globalAlpha = 1;
    }
  }

  /** Backlight behind the enemy — the reason your eye lands on it first. */
  private drawBacklight() {
    const c = this.c;
    const p = this.homeOf('enemy');
    const cy = p.y - this.h * 0.14;
    const glow = c.createRadialGradient(p.x, cy, 4, p.x, cy, this.h * 0.32);
    const col = this.enemy.isBoss ? 'rgba(255,110,70,' : this.enemy.isElite ? 'rgba(180,120,255,' : 'rgba(255,235,190,';
    glow.addColorStop(0, `${col}0.34)`);
    glow.addColorStop(0.55, `${col}0.12)`);
    glow.addColorStop(1, `${col}0)`);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = glow;
    c.fillRect(0, 0, this.w, this.h);
    c.restore();
  }

  private drawHills(layer: 'far' | 'near') {
    const c = this.c;
    const b = this.biome;
    const base = this.groundY;
    const [colour, amp, off, lift] =
      layer === 'far'
        ? ([b.hillFar, 0.055, 0.0, 0.17] as const)
        : ([b.hillNear, 0.075, 1.7, 0.08] as const);

    c.fillStyle = colour;
    c.beginPath();
    c.moveTo(0, base);
    for (let x = 0; x <= this.w; x += 12) {
      const n =
        Math.sin(x * 0.008 + off) * 0.6 + Math.sin(x * 0.021 + off * 2.3) * 0.3 + Math.sin(x * 0.004) * 0.5;
      c.lineTo(x, base - this.h * lift - n * this.h * amp);
    }
    c.lineTo(this.w, base);
    c.closePath();
    c.fill();

    if (layer !== 'near') return;
    // Fog band where the hills meet the clearing.
    const fg = c.createLinearGradient(0, base - this.h * 0.16, 0, base);
    fg.addColorStop(0, 'rgba(0,0,0,0)');
    fg.addColorStop(1, b.fog);
    c.fillStyle = fg;
    c.fillRect(0, base - this.h * 0.16, this.w, this.h * 0.16);
  }

  private drawGround() {
    const c = this.c;
    const b = this.biome;
    const g = c.createLinearGradient(0, this.groundY, 0, this.h);
    g.addColorStop(0, b.ground);
    g.addColorStop(1, b.groundB);
    c.fillStyle = g;
    c.fillRect(0, this.groundY, this.w, this.h - this.groundY);

    // Beaten circle of trodden earth — the arena floor the two of you share.
    c.save();
    c.translate(this.w * 0.5, this.groundY + this.h * 0.055);
    c.fillStyle = 'rgba(0,0,0,0.20)';
    c.beginPath();
    c.ellipse(0, 0, this.w * 0.46, this.h * 0.055, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.07)';
    c.lineWidth = 1.5;
    c.stroke();
    c.restore();

    // Darken toward the bottom so the action bar has something to sit on.
    const shade = c.createLinearGradient(0, this.groundY, 0, this.h);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = shade;
    c.fillRect(0, this.groundY, this.w, this.h - this.groundY);
  }

  /** Distant silhouettes on the far ridge — depth, not foreground furniture. */
  private drawProps() {
    const c = this.c;
    c.save();
    c.globalAlpha = 0.85;
    for (const p of this.props) {
      const x = p.x * this.w;
      const y = this.groundY - this.h * (0.10 + p.y * 0.05);
      const s = p.s * this.h * 0.032;
      c.save();
      c.translate(x, y);
      c.fillStyle = this.biome.hillFar;
      if (p.kind === 0) {
        // conifer
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(-s * 0.5, 0);
        c.lineTo(0, -s * 2.1);
        c.lineTo(s * 0.5, 0);
        c.closePath();
        c.fill();
      } else if (p.kind === 1) {
        // boulder
        c.beginPath();
        c.ellipse(0, 0, s * 0.7, s * 0.45, 0, Math.PI, 0);
        c.fill();
      } else {
        // broken pillar
        c.fillRect(-s * 0.16, -s * 1.3, s * 0.32, s * 1.3);
        c.fillRect(-s * 0.3, -s * 1.45, s * 0.6, s * 0.2);
      }
      c.restore();
    }
    c.restore();
  }

  /** Time value handed to a rig: local pose time for cycles, scene time for idles. */
  private rigTime(a: Actor): number {
    return a.pose === 'idle' || a.pose === 'run' || a.pose === 'victory' || a.pose === 'defend' || a.pose === 'charge'
      ? this.t
      : Math.max(0, a.poseT);
  }

  private drawFighters() {
    const c = this.c;
    const look = lookFromEquipment(this.ctx.state.equipment);

    // Ground shadows, squashed while airborne dashes happen.
    for (const side of ['enemy', 'player'] as Side[]) {
      const p = this.posOf(side);
      const hw = this.halfWidth(side);
      c.save();
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.beginPath();
      c.ellipse(p.x, p.y + 2, hw * 0.9, hw * 0.22, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }

    // Enemy first so an overlapping hero reads as nearer the camera.
    const fp = this.posOf('enemy');
    this.ctx.sprites.drawCreature(
      c,
      fp.x,
      fp.y,
      this.foeScale,
      this.enemy.id,
      poseFor(this.foe.pose),
      { time: this.rigTime(this.foe), facing: -1, flash: this.foe.flash, alpha: this.foe.alpha }
    );

    const hp = this.posOf('player');
    const heroPose = heroPoseFor(this.hero.pose);
    const heroOpts = { time: this.rigTime(this.hero), facing: 1 as const, flash: this.hero.flash, alpha: this.hero.alpha };
    if (this.hero.rim > 0) this.drawRim(hp.x, hp.y, look, heroPose, heroOpts, this.hero.rim);
    this.ctx.sprites.drawHero(c, hp.x, hp.y, this.heroScale, look, heroPose, heroOpts);
  }

  /** White silhouette copies offset around the hero — a rim of light. */
  private drawRim(
    x: number,
    y: number,
    look: ReturnType<typeof lookFromEquipment>,
    pose: HeroPose,
    opts: { time: number; facing: 1; flash: number; alpha: number },
    amount: number
  ) {
    // The buffer only needs to cover the hero, so it stays small and is
    // cheap to composite eight times.
    const bw = Math.ceil(this.halfWidth('player') * 4 + 40);
    const bh = Math.ceil(this.bodyHeight('player') * 1.35 + 40);
    const pw = Math.round(bw * this.dpr);
    const ph = Math.round(bh * this.dpr);
    if (!this.rimCanvas || this.rimCanvas.width !== pw || this.rimCanvas.height !== ph) {
      this.rimCanvas = document.createElement('canvas');
      this.rimCanvas.width = pw;
      this.rimCanvas.height = ph;
    }
    const rc = this.rimCanvas.getContext('2d');
    if (!rc) return;
    const ox = x - bw / 2;
    const oy = y - bh + 20;
    rc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    rc.clearRect(0, 0, bw, bh);
    this.ctx.sprites.drawHero(rc, x - ox, y - oy, this.heroScale, look, pose, { ...opts, flash: 0 });
    rc.save();
    rc.globalCompositeOperation = 'source-in';
    rc.fillStyle = '#eaf9ff';
    rc.fillRect(0, 0, bw, bh);
    rc.restore();

    const c = this.c;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.55 * amount;
    const r = 2.5 + 4 * amount;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.drawImage(this.rimCanvas, ox + Math.cos(a) * r, oy + Math.sin(a) * r, bw, bh);
    }
    c.restore();
  }

  private drawShots() {
    const c = this.c;
    for (const s of this.shots) {
      const col = ELEMENT_COLORS[s.element] ?? ELEMENT_COLORS.steel;
      const ang = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
      c.save();
      c.translate(s.x, s.y);
      c.rotate(ang);
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = col.a;
      c.globalAlpha = 0.35;
      c.beginPath();
      c.ellipse(0, 0, 22, 9, 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
      c.beginPath();
      c.ellipse(0, 0, 14, 4, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = col.b;
      c.beginPath();
      c.ellipse(4, 0, 7, 2.2, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }

  /** The parry ring: a closing circle that meets a target ring on the hero. */
  private drawQte() {
    const q = this.qte;
    if (!q) return;
    const c = this.c;
    const p = this.centre('player');
    const r1 = this.bodyHeight('player') * 0.5;
    const r0 = r1 * 3.2;
    const k = Math.min(1, q.t / q.dur);
    const r = r0 + (r1 - r0) * k;
    const inWindow = q.result === 'pending' && Math.abs(q.t - q.dur) <= q.window;
    const col = ELEMENT_COLORS.water;

    c.save();
    c.translate(p.x, p.y);
    c.lineCap = 'round';

    if (q.result === 'pending') {
      // Target ring (the "perfect" mark) with a ticking pulse near the moment.
      c.globalAlpha = 0.85;
      c.lineWidth = inWindow ? 4 : 2.5;
      c.strokeStyle = inWindow ? '#ffffff' : 'rgba(255,255,255,0.75)';
      c.setLineDash([6, 5]);
      c.beginPath();
      c.arc(0, 0, r1, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);

      // Closing ring.
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = inWindow ? '#ffffff' : k > 0.7 ? col.b : col.a;
      // Halo pass, then the crisp ring.
      c.globalAlpha = (0.5 + 0.5 * k) * 0.35;
      c.lineWidth = 10 + 12 * k;
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 0.5 + 0.5 * k;
      c.lineWidth = 3 + 3 * k;
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.stroke();
    } else {
      // Post flash: perfect blooms outward in white/cyan, a miss dies red.
      const s = Math.min(1, q.since / 0.4);
      const perfect = q.result === 'perfect';
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = (1 - s) * (perfect ? 0.95 : 0.4);
      c.strokeStyle = perfect ? '#ffffff' : '#ff6a7a';
      const R = perfect ? r1 + s * r1 * 1.6 : r1;
      c.lineWidth = perfect ? 22 - 12 * s : 8;
      c.globalAlpha *= 0.35;
      c.beginPath();
      c.arc(0, 0, R, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha /= 0.35;
      c.lineWidth = perfect ? 6 - 4 * s : 2;
      c.beginPath();
      c.arc(0, 0, R, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
  }

  private drawMotes() {
    const c = this.c;
    c.save();
    c.fillStyle = this.biome.ambientColor;
    for (const m of this.motes) {
      c.globalAlpha = 0.14 + 0.16 * Math.abs(Math.sin(this.t + m.x * 9));
      c.beginPath();
      c.arc(m.x * this.w, m.y * this.h, m.r, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }
}

/* ------------------------------------------------------------------ utils -- */

const CREATURE_POSES = new Set(['idle', 'attack', 'hurt', 'dead', 'charge']);
function poseFor(p: string): CreaturePose {
  if (p === 'defend' || p === 'victory' || p === 'cast' || p === 'run') return 'idle';
  return (CREATURE_POSES.has(p) ? p : 'idle') as CreaturePose;
}

const HERO_POSES = new Set(['run', 'idle', 'attack', 'cast', 'hurt', 'victory', 'defend']);
function heroPoseFor(p: string): HeroPose {
  if (p === 'dead') return 'hurt';
  if (p === 'charge') return 'cast';
  return (HERO_POSES.has(p) ? p : 'idle') as HeroPose;
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

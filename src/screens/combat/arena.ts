import type { GameContext } from '../../core/context';
import type { CreaturePose, HeroPose } from '../../render/api';
import { lookFromEquipment } from '../../render/api';
import type { EnemyInstance } from '../../game/types';
import { creatureExtent } from '../../render/sprites';
import { biomeFor, type Biome } from '../run/biomes';

/* ============================================================================
 * The battlefield canvas: a lit clearing beside the road, hero on the left,
 * the thing that stopped you on the right. Same biome palette as the run
 * screen, so a fight reads as happening *where you were*, not in a void.
 *
 * The screen tells the arena what happened ("hero attacks", "enemy is hurt")
 * and the arena owns all the timing of the resulting animation.
 * ========================================================================== */

type Side = 'player' | 'enemy';

interface Actor {
  pose: string;
  poseLeft: number;
  flash: number;
  lunge: number;
  alpha: number;
  dead: boolean;
}

const DEFAULT_HOLD = 0.45;

export class CombatArena {
  private c: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private t = 0;
  private biome: Biome;

  private hero: Actor = { pose: 'idle', poseLeft: 0, flash: 0, lunge: 0, alpha: 1, dead: false };
  private foe: Actor = { pose: 'idle', poseLeft: 0, flash: 0, lunge: 0, alpha: 1, dead: false };

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
  }

  /** Ground line the fighters stand on. */
  private get groundY() {
    return this.h * 0.74;
  }

  private posOf(side: Side) {
    return side === 'player'
      ? { x: this.w * 0.2, y: this.groundY + this.h * 0.035 }
      : { x: this.w * 0.68, y: this.groundY };
  }

  /**
   * Where floating numbers should appear. The canvas fills the screen root the
   * floats are parented to, so canvas coordinates are already the right ones.
   */
  anchor(side: Side): { x: number; y: number } {
    const p = this.posOf(side);
    return { x: p.x, y: p.y - this.h * (side === 'player' ? 0.16 : 0.2) };
  }

  /* ---------------------------------------------------------------- input -- */

  pose(side: Side, pose: HeroPose | CreaturePose | 'dead') {
    const a = side === 'player' ? this.hero : this.foe;
    if (a.dead) return;
    if (pose === 'dead') {
      a.dead = true;
      a.pose = 'dead';
      a.poseLeft = 999;
      return;
    }
    a.pose = pose;
    a.poseLeft = pose === 'idle' || pose === 'run' || pose === 'victory' ? 999 : DEFAULT_HOLD;
    if (pose === 'attack') a.lunge = 1;
  }

  hit(side: Side) {
    const a = side === 'player' ? this.hero : this.foe;
    a.flash = 1;
  }

  burst(side: Side, kind: Parameters<GameContext['fx']['burst']>[2]) {
    const p = this.posOf(side);
    this.ctx.fx.burst(p.x, p.y - this.h * 0.12, kind);
  }

  /* --------------------------------------------------------------- update -- */

  update(dt: number) {
    this.t += dt;
    for (const a of [this.hero, this.foe]) {
      a.flash = Math.max(0, a.flash - dt * 4.5);
      a.lunge = Math.max(0, a.lunge - dt * 3.2);
      if (a.poseLeft < 900) {
        a.poseLeft -= dt;
        if (a.poseLeft <= 0) a.pose = 'idle';
      }
      if (a.dead) a.alpha = Math.max(0.12, a.alpha - dt * 0.7);
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
    this.drawFighters();
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
    const p = this.posOf('enemy');
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

  private drawFighters() {
    const c = this.c;
    const look = lookFromEquipment(this.ctx.state.equipment);

    // Enemy first so an overlapping hero reads as nearer the camera.
    const fp = this.posOf('enemy');
    // `scale` 1 == 100px of painted silhouette, so the height budget is a
    // plain fraction of the arena. Long, low creatures (boars, serpents) are
    // then scaled down again so they never crowd the hero out of his own half.
    const ext = creatureExtent(this.enemy.id);
    const aspect = ext.width / ext.height;
    const byHeight = (this.h / 100) * (this.enemy.isBoss ? 0.40 : this.enemy.isElite ? 0.32 : 0.27);
    const byWidth = (this.w * (this.enemy.isBoss ? 0.66 : 0.56)) / (100 * aspect);
    const foeScale = Math.min(byHeight, byWidth);
    this.ctx.sprites.drawCreature(
      c,
      fp.x + this.foe.lunge * -this.w * 0.05,
      fp.y,
      foeScale,
      this.enemy.id,
      poseFor(this.foe.pose) as CreaturePose,
      { time: this.t, facing: -1, flash: this.foe.flash, alpha: this.foe.alpha }
    );

    const hp = this.posOf('player');
    const heroScale = (this.h / 100) * 0.25;
    this.ctx.sprites.drawHero(
      c,
      hp.x + this.hero.lunge * this.w * 0.06,
      hp.y,
      heroScale,
      look,
      heroPoseFor(this.hero.pose),
      { time: this.t, facing: 1, flash: this.hero.flash, alpha: this.hero.alpha }
    );
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

import type { GameContext } from '../../core/context';
import type { RunEncounter } from '../../game/encounters';
import { lookFromEquipment, type HeroLook } from '../../render/api';
import { biomeFor, type Biome, type SceneryKind } from './biomes';

/* ============================================================================
 * The runner world: a pseudo-3D road scrolling toward the camera with three
 * lanes, encounter markers approaching from the horizon, and a hero that
 * swerves into whichever lane the player commits to.
 *
 * All drawing here is procedural canvas work. Characters and creatures are
 * delegated to ctx.sprites — this file never draws a body itself.
 * ========================================================================== */

export type RunPhase = 'travel' | 'choose' | 'commit' | 'arrive' | 'boss';

const HORIZON_F = 0.30;
const GROUND_F = 0.855;
const PERSP_K = 0.42;
const Z_FAR = 9.5;
/** Where encounter markers first appear. Closer than the far plane so they
 *  are already readable when they resolve out of the fog. */
const Z_SPAWN = 7.2;
/** Lane centre as a fraction of the road half-width. */
const LANE_SPREAD = 0.62;
const METERS_PER_UNIT = 7;

interface Prop {
  z: number; // absolute world position
  side: -1 | 1;
  off: number; // lateral offset in half-width units (>1 = off road)
  kind: SceneryKind;
  seed: number;
  size: number;
}

interface Marker {
  node: RunEncounter;
  z: number; // absolute world position
  discarded: boolean;
  drift: number;
  alpha: number;
  bob: number;
}

interface Ambient {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
}

export class RunScene {
  private c: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private ctx: GameContext;
  private w = 0;
  private h = 0;
  private dpr = 1;

  private biome: Biome;
  private look: HeroLook;

  time = 0;
  private travel = 0;
  private speed = 1.6;
  private targetSpeed = 1.6;
  private props: Prop[] = [];
  private ambient: Ambient[] = [];
  private markers: Marker[] = [];

  phase: RunPhase = 'travel';
  private phaseT = 0;
  private heroLane = 1;
  private heroLaneTarget = 1;
  private chosen: Marker | null = null;
  private arrived = false;
  private bossHeat = 0;
  private impact = 0;
  private stars: { x: number; y: number; r: number; a: number }[] = [];
  private reduced: boolean;

  /** Seconds left to make a choice; the HUD renders a ring from this. */
  chooseLeft = 0;
  chooseWindow = 1;

  onArrive: (node: RunEncounter) => void = () => {};
  onSpawn: (nodes: RunEncounter[]) => void = () => {};
  /** Fired once when the player commits, so the screen can play SFX/HUD bits. */
  onCommit: (node: RunEncounter) => void = () => {};

  constructor(canvas: HTMLCanvasElement, ctx: GameContext) {
    this.canvas = canvas;
    this.ctx = ctx;
    const c2d = canvas.getContext('2d', { alpha: false });
    if (!c2d) throw new Error('2d context unavailable');
    this.c = c2d;
    this.biome = biomeFor(ctx.state.stats.worldCycle);
    this.look = lookFromEquipment(ctx.state.equipment);
    this.reduced = ctx.state.stats.settings.reducedMotion;
    this.speed = this.baseSpeed();
    this.targetSpeed = this.speed;
    this.seedProps();
  }

  /* --------------------------------------------------------------- setup -- */

  private baseSpeed(): number {
    const s = this.ctx.state.stats;
    return 1.45 + s.worldCycle * 0.12 + (s.progress / Math.max(1, s.progressMax)) * 0.35;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.seedStars();
    this.seedAmbient();
  }

  private seedStars() {
    this.stars = [];
    const n = this.biome.stars ? 60 : 20;
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h * HORIZON_F,
        r: 0.5 + Math.random() * 1.3,
        a: 0.25 + Math.random() * 0.7
      });
    }
  }

  private seedAmbient() {
    this.ambient = [];
    if (this.biome.ambient === 'none' || this.reduced) return;
    const n = this.biome.ambient === 'snow' ? 46 : 28;
    for (let i = 0; i < n; i++) this.ambient.push(this.newAmbient(true));
  }

  private newAmbient(anywhere = false): Ambient {
    const drifty = this.biome.ambient === 'leaf' || this.biome.ambient === 'spore';
    return {
      x: Math.random() * this.w,
      y: anywhere ? Math.random() * this.h : -10,
      vx: (Math.random() - 0.5) * (drifty ? 40 : 18),
      vy: 30 + Math.random() * (this.biome.ambient === 'ember' ? -90 : 90),
      r: 1 + Math.random() * (this.biome.ambient === 'snow' ? 2.4 : 1.8),
      a: 0.25 + Math.random() * 0.6
    };
  }

  private seedProps() {
    this.props = [];
    for (let i = 0; i < 46; i++) {
      this.props.push(this.newProp(Math.random() * Z_FAR));
    }
  }

  private newProp(z: number): Prop {
    const kinds = this.biome.scenery;
    return {
      z,
      side: Math.random() < 0.5 ? -1 : 1,
      off: 1.25 + Math.random() * 2.6,
      kind: kinds[Math.floor(Math.random() * kinds.length)],
      seed: Math.random() * 100,
      size: 0.7 + Math.random() * 0.8
    };
  }

  /* ---------------------------------------------------------- projection -- */

  private get horizonY() {
    return this.h * HORIZON_F;
  }
  private get groundY() {
    return this.h * GROUND_F;
  }

  private scaleAt(z: number): number {
    return 1 / (1 + Math.max(-0.9, z) * PERSP_K);
  }

  private yAt(z: number): number {
    return this.horizonY + (this.groundY - this.horizonY) * this.scaleAt(z);
  }

  /** Lateral bend of the road at distance z — gives the road a winding feel. */
  private bendAt(z: number): number {
    if (this.reduced) return 0;
    const b = Math.sin((this.travel + z) * 0.19) + 0.4 * Math.sin((this.travel + z) * 0.07);
    return b * z * z * 1.05;
  }

  private halfWidthAt(z: number): number {
    return this.w * 0.47 * this.scaleAt(z);
  }

  private centerXAt(z: number): number {
    return this.w * 0.5 + this.bendAt(z) * this.scaleAt(z) * 1.6;
  }

  private laneX(lane: number, z: number): number {
    return this.centerXAt(z) + (lane - 1) * LANE_SPREAD * this.halfWidthAt(z);
  }

  /* ----------------------------------------------------------- lifecycle -- */

  /** Starts an approach with three lane choices. */
  spawn(nodes: RunEncounter[], window = 6.2) {
    this.markers = nodes.map(node => ({
      node,
      z: this.travel + Z_SPAWN,
      discarded: false,
      drift: 0,
      alpha: 0,
      bob: Math.random() * 6
    }));
    this.chosen = null;
    this.arrived = false;
    this.phase = 'choose';
    this.phaseT = 0;
    this.chooseWindow = window;
    this.chooseLeft = window;
    this.targetSpeed = this.baseSpeed();
    this.onSpawn(nodes);
  }

  /** Starts the boss approach: one marker, centre lane, no way around. */
  spawnBoss(node: RunEncounter) {
    this.markers = [
      { node, z: this.travel + Z_SPAWN, discarded: false, drift: 0, alpha: 0, bob: 0 }
    ];
    this.chosen = this.markers[0];
    this.arrived = false;
    this.phase = 'boss';
    this.phaseT = 0;
    this.heroLaneTarget = 1;
    this.targetSpeed = this.baseSpeed() * 0.85;
  }

  get bossIntensity(): number {
    return this.bossHeat;
  }

  get activeNodes(): RunEncounter[] {
    return this.markers.filter(m => !m.discarded).map(m => m.node);
  }

  get canChoose(): boolean {
    return this.phase === 'choose';
  }

  /** Commits to a lane. Returns the node chosen, or null if not choosable. */
  choose(lane: number): RunEncounter | null {
    if (this.phase !== 'choose') return null;
    const target = this.markers.find(m => m.node.lane === lane);
    if (!target) return null;
    this.chosen = target;
    for (const m of this.markers) {
      if (m !== target) m.discarded = true;
    }
    this.heroLaneTarget = lane;
    this.phase = 'commit';
    this.phaseT = 0;
    this.targetSpeed = this.baseSpeed() * 1.75;
    this.onCommit(target.node);
    return target.node;
  }

  /** Boss charge — a tap makes you close the distance faster. */
  urge() {
    if (this.phase === 'boss') this.targetSpeed = this.baseSpeed() * 1.5;
  }

  /** Picks the lane under a screen point; falls back to a horizontal third. */
  laneAtPoint(px: number, py: number): number | null {
    if (this.phase !== 'choose') return null;
    let best: { lane: number; d: number } | null = null;
    for (const m of this.markers) {
      const z = m.z - this.travel;
      if (z < -0.2 || z > Z_FAR) continue;
      const s = this.scaleAt(z);
      const x = this.laneX(m.node.lane, z);
      const y = this.yAt(z) - 60 * s * this.uiScale;
      const r = Math.max(52, 150 * s * this.uiScale);
      const d = Math.hypot(px - x, py - y);
      if (d < r && (!best || d < best.d)) best = { lane: m.node.lane, d };
    }
    if (best) return best.lane;
    if (py < this.horizonY * 0.9) return null;
    const third = this.w / 3;
    return Math.max(0, Math.min(2, Math.floor(px / third)));
  }

  private get uiScale(): number {
    return this.h / 844;
  }

  /* -------------------------------------------------------------- update -- */

  update(dt: number) {
    this.time += dt;
    this.phaseT += dt;
    this.impact = Math.max(0, this.impact - dt * 2.2);

    // Speed easing.
    this.speed += (this.targetSpeed - this.speed) * Math.min(1, dt * 2.6);
    this.travel += this.speed * dt;
    this.ctx.state.addDistance(this.speed * dt * METERS_PER_UNIT);

    // Hero swerve.
    const ease = this.phase === 'commit' ? 6.5 : 4;
    this.heroLane += (this.heroLaneTarget - this.heroLane) * Math.min(1, dt * ease);

    // Recycle scenery.
    for (const p of this.props) {
      if (p.z - this.travel < -0.6) {
        p.z = this.travel + Z_FAR + Math.random() * 2;
        p.side = Math.random() < 0.5 ? -1 : 1;
        p.off = 1.25 + Math.random() * 2.6;
        p.kind = this.biome.scenery[Math.floor(Math.random() * this.biome.scenery.length)];
        p.size = 0.7 + Math.random() * 0.8;
        p.seed = Math.random() * 100;
      }
    }

    // Ambient weather.
    for (const a of this.ambient) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      if (a.y > this.h + 12 || a.y < -20 || a.x < -20 || a.x > this.w + 20) {
        Object.assign(a, this.newAmbient());
        if (this.biome.ambient === 'ember') a.y = this.h + 10;
      }
    }

    // Markers.
    for (const m of this.markers) {
      m.alpha = Math.min(1, m.alpha + dt * 2.4);
      if (m.discarded) {
        m.drift += dt * 2.6;
        m.alpha = Math.max(0, m.alpha - dt * 1.6);
      }
    }

    if (this.phase === 'choose') {
      this.chooseLeft = Math.max(0, this.chooseLeft - dt);
      const lead = this.markers[0];
      if (lead && lead.z - this.travel < 1.1) {
        // Out of road: the lane you're physically in is the lane you take.
        const nearest = this.markers.reduce((a, b) =>
          Math.abs(b.node.lane - this.heroLane) < Math.abs(a.node.lane - this.heroLane) ? b : a
        );
        this.choose(nearest.node.lane);
      }
    }

    if (this.phase === 'boss') {
      this.bossHeat = Math.min(1, this.bossHeat + dt * 0.35);
    } else {
      this.bossHeat = Math.max(0, this.bossHeat - dt * 1.2);
    }

    if ((this.phase === 'commit' || this.phase === 'boss') && this.chosen && !this.arrived) {
      const z = this.chosen.z - this.travel;
      if (z <= 0.28) {
        this.arrived = true;
        this.phase = 'arrive';
        this.impact = 1;
        this.targetSpeed = 0.3;
        const x = this.laneX(this.chosen.node.lane, 0);
        this.ctx.fx.burst(x, this.groundY - 30, this.chosen.node.kind === 'gold' ? 'coin' : 'dust', {
          count: 20,
          speed: 240
        });
        this.onArrive(this.chosen.node);
      }
    }
  }

  /* ---------------------------------------------------------------- draw -- */

  draw() {
    const c = this.c;
    const b = this.biome;
    c.save();
    if (this.impact > 0 && !this.reduced) {
      const k = this.impact * this.impact * 7;
      c.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
    }
    this.drawSky();
    this.drawHills();
    this.drawGround();
    this.drawRoad();

    // Everything on the road, painted far to near.
    const drawables: { z: number; fn: () => void }[] = [];
    for (const p of this.props) {
      const z = p.z - this.travel;
      if (z < -0.5 || z > Z_FAR) continue;
      drawables.push({ z, fn: () => this.drawProp(p, z) });
    }
    for (const m of this.markers) {
      const z = m.z - this.travel;
      if (z < -0.5 || z > Z_FAR + 1 || m.alpha <= 0.01) continue;
      drawables.push({ z, fn: () => this.drawMarker(m, z) });
    }
    drawables.sort((a, d) => d.z - a.z);
    for (const d of drawables) d.fn();

    this.drawHero();
    this.drawAmbient();
    this.drawSpeedLines();
    this.drawVignette();
    this.ctx.fx.draw(c);
    c.restore();
    void b;
  }

  private drawSky() {
    const c = this.c;
    const b = this.biome;
    const hy = this.horizonY;
    const g = c.createLinearGradient(0, 0, 0, hy + 20);
    g.addColorStop(0, b.skyTop);
    g.addColorStop(1, b.skyBottom);
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, hy + 24);

    if (b.stars) {
      for (const s of this.stars) {
        const tw = 0.6 + 0.4 * Math.sin(this.time * 2 + s.x);
        c.globalAlpha = s.a * tw;
        c.fillStyle = '#ffffff';
        c.fillRect(s.x, s.y, s.r, s.r);
      }
      c.globalAlpha = 1;
    }

    // Sun / moon sitting just above the vanishing point.
    const sx = this.w * 0.5 + this.bendAt(Z_FAR) * 0.06;
    const sy = hy - this.h * 0.09;
    const rr = this.w * 0.16;
    const glow = c.createRadialGradient(sx, sy, 0, sx, sy, rr * 2.4);
    glow.addColorStop(0, b.sunGlow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(sx - rr * 2.4, sy - rr * 2.4, rr * 4.8, rr * 4.8);
    c.fillStyle = b.sun;
    c.globalAlpha = 0.85;
    c.beginPath();
    c.arc(sx, sy, rr * 0.55, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }

  private drawHills() {
    const c = this.c;
    const b = this.biome;
    const hy = this.horizonY;
    const layers = [
      { color: b.hillFar, amp: this.h * 0.075, base: hy + 2, speed: 0.5, step: 62 },
      { color: b.hillNear, amp: this.h * 0.05, base: hy + 8, speed: 1.4, step: 40 }
    ];
    for (const L of layers) {
      c.fillStyle = L.color;
      c.beginPath();
      c.moveTo(0, L.base);
      const off = (this.travel * L.speed * 9) % (L.step * 2);
      for (let x = -L.step; x <= this.w + L.step; x += 6) {
        const t = (x + off) / L.step;
        const y =
          L.base -
          L.amp * (0.55 + 0.45 * Math.sin(t * 0.9)) * (0.7 + 0.3 * Math.sin(t * 0.31 + 1.7));
        c.lineTo(x, y);
      }
      c.lineTo(this.w + L.step, L.base + 30);
      c.lineTo(-L.step, L.base + 30);
      c.closePath();
      c.fill();
    }
    // Haze where the world meets the sky.
    const fg = c.createLinearGradient(0, hy - this.h * 0.08, 0, hy + this.h * 0.06);
    fg.addColorStop(0, 'rgba(0,0,0,0)');
    fg.addColorStop(0.55, b.fog);
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fg;
    c.fillRect(0, hy - this.h * 0.08, this.w, this.h * 0.14);
  }

  private drawGround() {
    const c = this.c;
    const b = this.biome;
    const hy = this.horizonY;
    const g = c.createLinearGradient(0, hy, 0, this.h);
    g.addColorStop(0, b.ground);
    g.addColorStop(1, b.groundB);
    c.fillStyle = g;
    c.fillRect(0, hy, this.w, this.h - hy);
  }

  private drawRoad() {
    const c = this.c;
    const b = this.biome;
    const rows = 64;
    const hy = this.horizonY;
    const gy = this.groundY;
    const span = this.h - hy;

    let prev: { y: number; z: number; cx: number; hw: number } | null = null;
    for (let i = 0; i <= rows; i++) {
      const y = hy + (span * i) / rows;
      // Invert the perspective mapping to get the depth at this screen row.
      const s = (y - hy) / (gy - hy);
      if (s <= 0.0001) continue;
      const z = (1 / s - 1) / PERSP_K;
      if (z > Z_FAR * 1.6) continue;
      const cx = this.centerXAt(z);
      const hw = this.halfWidthAt(z);
      if (prev) {
        const world = this.travel + z;
        const band = Math.floor(world * 1.6) % 2 === 0;
        c.fillStyle = band ? b.roadA : b.roadB;
        c.beginPath();
        c.moveTo(prev.cx - prev.hw, prev.y);
        c.lineTo(prev.cx + prev.hw, prev.y);
        c.lineTo(cx + hw, y);
        c.lineTo(cx - hw, y);
        c.closePath();
        c.fill();

        // Shoulders, drawn as quads so the edge stays a clean diagonal.
        c.fillStyle = b.roadEdge;
        c.globalAlpha = 0.55;
        const e = Math.max(1, 7 * this.scaleAt(z));
        const pe = Math.max(1, 7 * this.scaleAt(prev.z));
        for (const k of [-1, 1]) {
          c.beginPath();
          c.moveTo(prev.cx + k * prev.hw, prev.y);
          c.lineTo(prev.cx + k * (prev.hw + pe), prev.y);
          c.lineTo(cx + k * (hw + e), y + 1);
          c.lineTo(cx + k * hw, y + 1);
          c.closePath();
          c.fill();
        }
        c.globalAlpha = 1;

        // Lane dashes.
        const f = (this.travel + z) % 1;
        if (f < 0.42) {
          c.fillStyle = b.stripe;
          c.globalAlpha = 0.5 * Math.min(1, this.scaleAt(z) * 5);
          for (const k of [-1, 1]) {
            const dx = cx + k * hw * (LANE_SPREAD * 0.5 + 0.16);
            const pdx = prev.cx + k * prev.hw * (LANE_SPREAD * 0.5 + 0.16);
            const dw = Math.max(1, 4 * this.scaleAt(z));
            c.beginPath();
            c.moveTo(pdx - dw, prev.y);
            c.lineTo(pdx + dw, prev.y);
            c.lineTo(dx + dw, y);
            c.lineTo(dx - dw, y);
            c.closePath();
            c.fill();
          }
          c.globalAlpha = 1;
        }
      }
      prev = { y, z, cx, hw };
    }

    // Distance fog over the far road.
    const fg = c.createLinearGradient(0, hy, 0, hy + this.h * 0.16);
    fg.addColorStop(0, b.fog);
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = fg;
    c.fillRect(0, hy, this.w, this.h * 0.16);

    // Lane glow under the hero's target lane while committing.
    if (this.phase !== 'boss') {
      const lane = this.heroLaneTarget;
      c.save();
      c.globalAlpha = 0.16 + 0.06 * Math.sin(this.time * 4);
      const zTop = 3.2;
      const lg = c.createLinearGradient(0, this.yAt(zTop), 0, this.yAt(0));
      lg.addColorStop(0, 'rgba(127,240,221,0)');
      lg.addColorStop(1, 'rgba(127,240,221,0.9)');
      c.fillStyle = lg;
      c.beginPath();
      c.moveTo(this.laneX(lane - 0.42, zTop), this.yAt(zTop));
      c.lineTo(this.laneX(lane + 0.42, zTop), this.yAt(zTop));
      c.lineTo(this.laneX(lane + 0.42, 0), this.yAt(0));
      c.lineTo(this.laneX(lane - 0.42, 0), this.yAt(0));
      c.closePath();
      c.fill();
      c.restore();
    }
  }

  /* ---------------------------------------------------------------- props -- */

  private drawProp(p: Prop, z: number) {
    const c = this.c;
    const b = this.biome;
    const s = this.scaleAt(z);
    const x = this.centerXAt(z) + p.side * p.off * this.halfWidthAt(z);
    const y = this.yAt(z);
    if (x < -120 || x > this.w + 120) return;
    const h = 120 * s * p.size * this.uiScale;
    if (h < 1.2) return;
    c.save();
    c.translate(x, y);
    const fade = Math.min(1, s * 6);
    c.globalAlpha = fade;

    switch (p.kind) {
      case 'pine':
        c.fillStyle = b.sceneryA;
        c.fillRect(-h * 0.05, -h * 0.28, h * 0.1, h * 0.28);
        c.fillStyle = b.sceneryB;
        for (let i = 0; i < 3; i++) {
          const yy = -h * (0.28 + i * 0.22);
          const ww = h * (0.34 - i * 0.08);
          c.beginPath();
          c.moveTo(0, yy - h * 0.34);
          c.lineTo(-ww, yy);
          c.lineTo(ww, yy);
          c.closePath();
          c.fill();
        }
        break;
      case 'tree':
        c.fillStyle = b.sceneryA;
        c.fillRect(-h * 0.06, -h * 0.42, h * 0.12, h * 0.42);
        c.fillStyle = b.sceneryB;
        c.beginPath();
        c.arc(0, -h * 0.6, h * 0.3, 0, Math.PI * 2);
        c.arc(-h * 0.2, -h * 0.46, h * 0.2, 0, Math.PI * 2);
        c.arc(h * 0.2, -h * 0.48, h * 0.22, 0, Math.PI * 2);
        c.fill();
        break;
      case 'rock':
        c.fillStyle = b.sceneryA;
        c.beginPath();
        c.moveTo(-h * 0.3, 0);
        c.lineTo(-h * 0.16, -h * 0.28);
        c.lineTo(h * 0.08, -h * 0.34);
        c.lineTo(h * 0.3, 0);
        c.closePath();
        c.fill();
        break;
      case 'cactus':
        c.fillStyle = b.sceneryB;
        c.fillRect(-h * 0.07, -h * 0.6, h * 0.14, h * 0.6);
        c.fillRect(-h * 0.26, -h * 0.42, h * 0.19, h * 0.09);
        c.fillRect(-h * 0.26, -h * 0.42, h * 0.09, h * 0.22);
        c.fillRect(h * 0.09, -h * 0.5, h * 0.17, h * 0.09);
        c.fillRect(h * 0.17, -h * 0.5, h * 0.09, h * 0.26);
        break;
      case 'crystal': {
        const glow = c.createRadialGradient(0, -h * 0.3, 0, 0, -h * 0.3, h * 0.6);
        glow.addColorStop(0, b.sceneryB + '88');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = glow;
        c.fillRect(-h * 0.6, -h * 0.9, h * 1.2, h * 1.2);
        c.fillStyle = b.sceneryB;
        c.beginPath();
        c.moveTo(0, -h * 0.72);
        c.lineTo(h * 0.16, -h * 0.2);
        c.lineTo(0, 0);
        c.lineTo(-h * 0.16, -h * 0.2);
        c.closePath();
        c.fill();
        break;
      }
      case 'ruin':
        c.fillStyle = b.sceneryA;
        c.fillRect(-h * 0.24, -h * 0.5, h * 0.16, h * 0.5);
        c.fillRect(h * 0.08, -h * 0.34, h * 0.16, h * 0.34);
        c.fillStyle = b.sceneryB;
        c.globalAlpha = fade * 0.5;
        c.fillRect(-h * 0.24, -h * 0.54, h * 0.48, h * 0.06);
        break;
      case 'bone':
        c.fillStyle = b.sceneryB;
        c.globalAlpha = fade * 0.8;
        for (let i = 0; i < 3; i++) {
          c.save();
          c.rotate((p.seed + i) * 0.7);
          c.fillRect(-h * 0.02, -h * 0.3, h * 0.04, h * 0.3);
          c.restore();
        }
        break;
      case 'mushroom':
        c.fillStyle = b.sceneryA;
        c.fillRect(-h * 0.05, -h * 0.3, h * 0.1, h * 0.3);
        c.fillStyle = b.sceneryB;
        c.beginPath();
        c.ellipse(0, -h * 0.3, h * 0.22, h * 0.14, 0, Math.PI, 0);
        c.fill();
        break;
    }
    c.restore();
  }

  /* -------------------------------------------------------------- markers -- */

  private dangerColor(d: number): string {
    return ['#5ee88f', '#4fd8c4', '#f2b544', '#ff4d6d'][Math.max(0, Math.min(3, d))];
  }

  private drawMarker(m: Marker, z: number) {
    const c = this.c;
    const node = m.node;
    const s = this.scaleAt(z);
    const drift = m.discarded ? m.drift * m.drift * 260 * (node.lane === 1 ? 1 : node.lane - 1) : 0;
    const x = this.laneX(node.lane, z) + drift;
    const y = this.yAt(z);
    const u = s * this.uiScale;
    const col = this.dangerColor(node.danger);
    const isBoss = node.kind === 'boss';
    const bob = Math.sin(this.time * 3 + m.bob) * 4 * u;

    c.save();
    c.globalAlpha = m.alpha;

    // Ground pad: a coloured pool of light so the lane reads at any distance.
    const padW = (isBoss ? 260 : 150) * u;
    const padH = padW * 0.34;
    const pulse = 0.7 + 0.3 * Math.sin(this.time * (isBoss ? 6 : 3.2));
    const pad = c.createRadialGradient(x, y, 0, x, y, padW);
    pad.addColorStop(0, hexA(col, 0.55 * pulse));
    pad.addColorStop(0.55, hexA(col, 0.2 * pulse));
    pad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = pad;
    c.save();
    c.translate(x, y);
    c.scale(1, padH / padW);
    c.beginPath();
    c.arc(0, 0, padW, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // Beam of light rising from the marker — visible even at the horizon.
    const beamH = (isBoss ? 460 : 240) * u;
    const beam = c.createLinearGradient(x, y - beamH, x, y);
    beam.addColorStop(0, 'rgba(0,0,0,0)');
    beam.addColorStop(1, hexA(col, isBoss ? 0.34 : 0.22));
    c.fillStyle = beam;
    const bw = padW * 0.34;
    c.beginPath();
    c.moveTo(x - bw * 0.35, y - beamH);
    c.lineTo(x + bw * 0.35, y - beamH);
    c.lineTo(x + bw, y);
    c.lineTo(x - bw, y);
    c.closePath();
    c.fill();

    // The thing itself.
    this.drawNodeBody(node, x, y + bob * 0.3, u, col);

    // Label plate. Far away the three plates would pile up on the vanishing
    // point, so they are fanned out sideways and stacked at different heights,
    // then converge onto their markers as the lanes separate.
    const lab = Math.min(1, Math.max(0, (s - 0.13) / 0.12));
    if (lab > 0.02) {
      const conv = Math.min(1, s * 2.6);
      // Each lane owns its own vertical tier, always — three plates never fit
      // side by side on a phone, and letting them converge horizontally made
      // them overlap into unreadable mush near the vanishing point.
      const tier = (2 - node.lane) * 42 * this.uiScale;
      const lx = x + (1 - conv) * this.w * 0.16 * (node.lane - 1);
      const ly = y - (isBoss ? 190 : 120) * u + bob - tier;
      c.globalAlpha = m.alpha * lab * 0.45;
      c.strokeStyle = col;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(lx, ly);
      c.lineTo(x, y - 6 * u);
      c.stroke();
      c.globalAlpha = m.alpha * lab;
      this.drawLabel(node, lx, ly, Math.min(1.05, Math.max(0.74, s * 2.1)), col);
    }
    c.restore();
  }

  private drawNodeBody(node: RunEncounter, x: number, y: number, u: number, col: string) {
    const c = this.c;
    const t = this.time;
    const size = 110 * u;

    if (node.enemy || node.kind === 'boss') {
      const id = node.enemy?.id ?? 'b_ratking';
      const scale = (node.kind === 'boss' ? 2.3 : node.kind === 'elite' ? 1.5 : 1.25) * u * 1.25;
      if (scale > 0.05) {
        this.ctx.sprites.drawCreature(c, x, y, scale, id, node.kind === 'boss' ? 'charge' : 'idle', {
          time: t,
          facing: -1
        });
      }
      return;
    }

    c.save();
    c.translate(x, y);
    switch (node.kind) {
      case 'gold': {
        c.fillStyle = '#c98a2b';
        c.beginPath();
        c.ellipse(0, -size * 0.06, size * 0.34, size * 0.13, 0, 0, Math.PI * 2);
        c.fill();
        for (let i = 0; i < 7; i++) {
          const a = i * 1.7;
          const cx = Math.cos(a) * size * 0.2;
          const cy = -size * 0.1 - (i % 3) * size * 0.09;
          c.fillStyle = i % 2 ? '#f2b544' : '#ffd873';
          c.beginPath();
          c.ellipse(cx, cy, size * 0.12, size * 0.05, 0, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = 'rgba(255,255,255,0.7)';
        c.beginPath();
        c.arc(size * 0.1, -size * 0.3, size * 0.03 * (1 + Math.sin(t * 5)), 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'treasure': {
        const w = size * 0.42;
        const hh = size * 0.3;
        c.fillStyle = '#6b4326';
        c.fillRect(-w, -hh, w * 2, hh);
        c.fillStyle = '#8a5a33';
        c.beginPath();
        c.moveTo(-w, -hh);
        c.quadraticCurveTo(0, -hh * 2.1, w, -hh);
        c.closePath();
        c.fill();
        c.fillStyle = '#f2b544';
        c.fillRect(-w * 0.14, -hh * 1.35, w * 0.28, hh * 0.85);
        c.fillStyle = hexA(col, 0.5);
        c.fillRect(-w, -hh * 1.05, w * 2, hh * 0.12);
        break;
      }
      case 'rest': {
        c.fillStyle = '#5a3d24';
        c.fillRect(-size * 0.26, -size * 0.08, size * 0.52, size * 0.08);
        c.fillRect(-size * 0.2, -size * 0.14, size * 0.4, size * 0.07);
        for (let i = 0; i < 3; i++) {
          const f = 1 + 0.25 * Math.sin(t * 9 + i * 2);
          c.fillStyle = ['#ff8a3d', '#ffc861', '#fff0b0'][i];
          c.beginPath();
          c.moveTo(0, -size * (0.18 + 0.34 * f * (1 - i * 0.22)));
          c.lineTo(size * (0.17 - i * 0.05) * f, -size * 0.12);
          c.lineTo(-size * (0.17 - i * 0.05) * f, -size * 0.12);
          c.closePath();
          c.fill();
        }
        break;
      }
      case 'shrine': {
        c.save();
        c.rotate(Math.sin(t * 1.4) * 0.08);
        c.fillStyle = '#b79bff';
        c.beginPath();
        c.moveTo(0, -size * 0.62);
        c.lineTo(size * 0.16, -size * 0.3);
        c.lineTo(0, -size * 0.02);
        c.lineTo(-size * 0.16, -size * 0.3);
        c.closePath();
        c.fill();
        c.restore();
        c.strokeStyle = hexA('#b79bff', 0.6);
        c.lineWidth = Math.max(1, size * 0.03);
        c.beginPath();
        c.ellipse(0, -size * 0.3, size * 0.34, size * 0.1, Math.sin(t) * 0.3, 0, Math.PI * 2);
        c.stroke();
        break;
      }
      case 'shop': {
        c.fillStyle = '#5f4a33';
        c.fillRect(-size * 0.34, -size * 0.38, size * 0.68, size * 0.32);
        for (let i = 0; i < 5; i++) {
          c.fillStyle = i % 2 ? '#e05a5a' : '#f4f0e6';
          c.fillRect(-size * 0.4 + i * size * 0.16, -size * 0.52, size * 0.16, size * 0.14);
        }
        c.fillStyle = '#2c2118';
        c.beginPath();
        c.arc(-size * 0.2, -size * 0.05, size * 0.09, 0, Math.PI * 2);
        c.arc(size * 0.2, -size * 0.05, size * 0.09, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'mystery':
      default: {
        const r = size * 0.26 * (1 + 0.06 * Math.sin(t * 4));
        const g = c.createRadialGradient(0, -size * 0.32, 0, 0, -size * 0.32, r * 1.8);
        g.addColorStop(0, hexA(col, 0.8));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(0, -size * 0.32, r * 1.8, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#0b0d16';
        c.beginPath();
        c.arc(0, -size * 0.32, r, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = col;
        c.font = `bold ${Math.round(size * 0.34)}px ${FONT}`;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText('?', 0, -size * 0.3);
        break;
      }
    }
    c.restore();
  }

  private drawLabel(node: RunEncounter, x: number, y: number, k: number, col: string) {
    /* eslint-disable-next-line no-param-reassign -- x is clamped to the viewport below */
    const c = this.c;
    const padX = 12 * k;
    const titleSize = Math.round(15 * k);
    const subSize = Math.round(11 * k);
    c.font = `700 ${titleSize}px ${FONT}`;
    const tw = c.measureText(node.title.toUpperCase()).width;
    c.font = `600 ${subSize}px ${FONT}`;
    const rw = c.measureText(node.rewardHint).width;
    const w = Math.max(tw, rw) + padX * 2;
    const h = (node.rewardHint ? 40 : 26) * k;
    // Keep the whole plate on screen; a clipped label is worse than a nudged one.
    const margin = 6;
    x = Math.min(this.w - margin - w / 2, Math.max(margin + w / 2, x));
    const left = x - w / 2;
    const top = y - h;

    roundRect(c, left, top, w, h, 8 * k);
    c.fillStyle = 'rgba(8,10,20,0.82)';
    c.fill();
    c.strokeStyle = hexA(col, 0.85);
    c.lineWidth = Math.max(1, 1.6 * k);
    c.stroke();

    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#f2f4fb';
    c.font = `700 ${titleSize}px ${FONT}`;
    c.fillText(node.title.toUpperCase(), x, top + h * (node.rewardHint ? 0.32 : 0.5));
    if (node.rewardHint) {
      c.fillStyle = col;
      c.font = `600 ${subSize}px ${FONT}`;
      c.fillText(node.rewardHint, x, top + h * 0.73);
    }

    // Danger pips ride the plate's top-right corner, the tag its top-left, so
    // neither can be buried by the plate stacked above it.
    const pipR = 3 * k;
    const gap = 9 * k;
    const total = 3;
    const pipRight = left + w - 10 * k;
    for (let i = 0; i < total; i++) {
      c.beginPath();
      c.arc(pipRight - (total - 1 - i) * gap, top + 1 * k, pipR, 0, Math.PI * 2);
      c.fillStyle = i < node.danger ? col : 'rgba(255,255,255,0.18)';
      c.fill();
    }

    if (node.tag) {
      c.font = `800 ${Math.round(9 * k)}px ${FONT}`;
      const tagW = c.measureText(node.tag).width + 10 * k;
      roundRect(c, left + 8 * k, top - 7 * k, tagW, 14 * k, 7 * k);
      c.fillStyle = col;
      c.fill();
      c.fillStyle = '#07080f';
      c.fillText(node.tag, left + 8 * k + tagW / 2, top + 0.5 * k);
    }
  }

  /* ----------------------------------------------------------------- hero -- */

  private drawHero() {
    const c = this.c;
    const zh = 0.12;
    const x = this.laneX(this.heroLane, zh);
    const y = this.yAt(zh);
    const scale = 1.35 * this.uiScale;
    const bounce = this.reduced ? 0 : Math.abs(Math.sin(this.time * 9)) * 4;

    // Contact shadow.
    c.save();
    c.globalAlpha = 0.4;
    c.fillStyle = '#000';
    c.beginPath();
    c.ellipse(x, y + 2, 34 * scale, 9 * scale, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    // Dust kicked up at the heels.
    if (!this.reduced) {
      c.save();
      c.globalAlpha = 0.25;
      c.fillStyle = this.biome.roadEdge;
      for (let i = 0; i < 4; i++) {
        const p = (this.time * 2.4 + i * 0.25) % 1;
        const r = (6 + p * 26) * scale;
        c.globalAlpha = 0.22 * (1 - p);
        c.beginPath();
        c.ellipse(x - 18 * scale - p * 40 * scale, y - p * 12 * scale, r * 0.6, r * 0.3, 0, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    this.ctx.sprites.drawHero(c, x, y - bounce, scale, this.look, 'run', {
      time: this.time,
      facing: 1
    });
  }

  /* -------------------------------------------------------------- effects -- */

  private drawAmbient() {
    if (this.ambient.length === 0) return;
    const c = this.c;
    c.save();
    c.fillStyle = this.biome.ambientColor;
    for (const a of this.ambient) {
      c.globalAlpha = a.a * 0.8;
      c.beginPath();
      c.arc(a.x, a.y, a.r, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  private drawSpeedLines() {
    if (this.reduced) return;
    const intensity = Math.max(0, (this.speed - this.baseSpeed()) / 1.4);
    const n = 8;
    const c = this.c;
    const vx = this.centerXAt(Z_FAR);
    const vy = this.horizonY - this.h * 0.02;
    c.save();
    c.strokeStyle = '#ffffff';
    c.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const seed = i * 2.399;
      const p = ((this.time * (1.1 + intensity * 2.2) + seed) % 1);
      const ang = seed % (Math.PI * 2);
      const dir = { x: Math.cos(ang), y: Math.sin(ang) * 0.55 + 0.4 };
      const d0 = 60 + p * this.w * 1.3;
      const d1 = d0 + 40 + intensity * 90;
      c.globalAlpha = (0.05 + intensity * 0.22) * Math.min(1, p * 3) * (1 - p);
      c.lineWidth = 1.5 + intensity * 1.5;
      c.beginPath();
      c.moveTo(vx + dir.x * d0, vy + dir.y * d0);
      c.lineTo(vx + dir.x * d1, vy + dir.y * d1);
      c.stroke();
    }
    c.restore();
  }

  private drawVignette() {
    const c = this.c;
    const g = c.createRadialGradient(
      this.w * 0.5,
      this.h * 0.5,
      this.h * 0.28,
      this.w * 0.5,
      this.h * 0.5,
      this.h * 0.78
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);

    if (this.bossHeat > 0.01) {
      const p = this.bossHeat * (0.55 + 0.45 * Math.sin(this.time * 5));
      const r = c.createRadialGradient(
        this.w * 0.5,
        this.h * 0.45,
        this.h * 0.2,
        this.w * 0.5,
        this.h * 0.45,
        this.h * 0.8
      );
      r.addColorStop(0, 'rgba(0,0,0,0)');
      r.addColorStop(1, `rgba(255,40,70,${0.34 * p})`);
      c.fillStyle = r;
      c.fillRect(0, 0, this.w, this.h);
    }
    if (this.impact > 0) {
      c.fillStyle = `rgba(255,255,255,${this.impact * 0.35})`;
      c.fillRect(0, 0, this.w, this.h);
    }
  }
}

const FONT = `'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif`;

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

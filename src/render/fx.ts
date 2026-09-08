import type { BurstKind, BurstOpts, FloatKind, FxElement, FxKit } from './api';

/* ============================================================================
 * Particles + DOM juice. One flat particle list, every particle is a small
 * state record drawn by its `shape`. Element FX (fire embers, water arcs,
 * void motes…) are just presets that pick shapes, colours and forces.
 * ========================================================================== */

type Shape =
  | 'circle'
  | 'spark'
  | 'ring'
  | 'ember'
  | 'drop'
  | 'mote'
  | 'ray'
  | 'slash'
  | 'arc'
  | 'shard'
  | 'glint';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  shape: Shape;
  /** Velocity damping per second (1 = none). */
  drag: number;
  /** Orientation for directional shapes, radians. */
  rot: number;
  /** Length for lines/rays/slashes. */
  len: number;
  /** Additive blending for glows. */
  add: boolean;
  /** Spawn delay so a burst can stagger (claw slashes, ray fans). */
  delay: number;
}

const BURST_PRESETS: Record<BurstKind, { color: string; count: number; speed: number; gravity: number; shape: Shape }> = {
  hit: { color: '#ffd9a0', count: 12, speed: 190, gravity: 420, shape: 'spark' },
  crit: { color: '#ffe066', count: 22, speed: 300, gravity: 380, shape: 'spark' },
  heal: { color: '#5ee88f', count: 14, speed: 110, gravity: -140, shape: 'circle' },
  coin: { color: '#f2c14e', count: 16, speed: 200, gravity: 620, shape: 'circle' },
  magic: { color: '#a98bff', count: 20, speed: 160, gravity: -60, shape: 'circle' },
  dust: { color: '#6b7280', count: 8, speed: 90, gravity: 160, shape: 'circle' },
  death: { color: '#ff6b81', count: 30, speed: 260, gravity: 300, shape: 'spark' },
  levelup: { color: '#7ee8ff', count: 34, speed: 240, gravity: -120, shape: 'ring' }
};

/** Palette per element: primary, highlight, and a deep shade. */
export const ELEMENT_COLORS: Record<FxElement, { a: string; b: string; deep: string }> = {
  steel: { a: '#e8f0ff', b: '#ffffff', deep: '#8fa3c8' },
  fire: { a: '#ff8a3d', b: '#ffd166', deep: '#b8321a' },
  water: { a: '#4fc8ff', b: '#cdf4ff', deep: '#1a5fa8' },
  void: { a: '#7b4bd6', b: '#c39cff', deep: '#12061f' },
  holy: { a: '#ffd166', b: '#fff6d6', deep: '#c48a12' },
  metal: { a: '#ffe9b0', b: '#ffffff', deep: '#8a7a55' },
  beast: { a: '#ff6a5a', b: '#ffd0c4', deep: '#7a1b14' },
  frost: { a: '#8fe3ff', b: '#e6fbff', deep: '#3a7fb8' },
  arcane: { a: '#b98cff', b: '#ead9ff', deep: '#5a2fa8' },
  poison: { a: '#8ce05a', b: '#dcffc4', deep: '#2f6b1a' }
};

const TAU = Math.PI * 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class Fx implements FxKit {
  private particles: Particle[] = [];
  private flashEl: HTMLElement | null = null;

  /* ---------------------------------------------------------------- core -- */

  private spawn(p: Partial<Particle> & { x: number; y: number; life: number; color: string; shape: Shape }) {
    this.particles.push({
      vx: 0,
      vy: 0,
      size: 3,
      gravity: 0,
      drag: 1,
      rot: 0,
      len: 0,
      add: false,
      delay: 0,
      maxLife: p.life,
      ...p
    });
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      if (p.drag !== 1) {
        const k = Math.pow(p.drag, dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(c: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      if (p.delay > 0) continue;
      const t = Math.max(0, Math.min(1, p.life / p.maxLife));
      c.save();
      if (p.add) c.globalCompositeOperation = 'lighter';
      c.globalAlpha = t;
      c.fillStyle = p.color;
      c.strokeStyle = p.color;
      c.lineCap = 'round';
      switch (p.shape) {
        case 'spark':
        case 'shard':
          c.lineWidth = Math.max(1, p.size * 0.5);
          c.beginPath();
          c.moveTo(p.x, p.y);
          c.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
          c.stroke();
          break;
        case 'ring':
          c.lineWidth = 2;
          c.beginPath();
          c.arc(p.x, p.y, p.size * (2 - t), 0, TAU);
          c.stroke();
          break;
        case 'ember': {
          // A flickering tapered dot with a soft glow — reads as a live spark.
          const flick = 0.7 + 0.3 * Math.sin((p.life + p.x) * 40);
          const r = p.size * (0.4 + 0.6 * t) * flick;
          // Two fills instead of shadowBlur: the blur costs ~10x per particle.
          c.globalAlpha = t * 0.35;
          c.beginPath();
          c.arc(p.x, p.y, r * 2.2, 0, TAU);
          c.fill();
          c.globalAlpha = t;
          c.beginPath();
          c.arc(p.x, p.y, r, 0, TAU);
          c.fill();
          break;
        }
        case 'drop': {
          const r = p.size * (0.5 + 0.5 * t);
          c.beginPath();
          c.ellipse(p.x, p.y, r * 0.7, r * 1.15, Math.atan2(p.vy, p.vx) + Math.PI / 2, 0, TAU);
          c.fill();
          break;
        }
        case 'mote': {
          const r = p.size * (0.3 + 0.7 * (1 - t));
          c.globalAlpha = t * 0.3;
          c.beginPath();
          c.arc(p.x, p.y, r * 1.9, 0, TAU);
          c.fill();
          c.globalAlpha = t;
          c.beginPath();
          c.arc(p.x, p.y, r, 0, TAU);
          c.fill();
          break;
        }
        case 'ray': {
          // Line from the origin outward, growing then fading.
          const grow = 1 - t;
          const L = p.len * Math.min(1, grow * 2.2);
          c.lineWidth = p.size * (0.4 + 0.6 * t);
          c.globalAlpha = t * 0.9;
          c.beginPath();
          c.moveTo(p.x, p.y);
          c.lineTo(p.x + Math.cos(p.rot) * L, p.y + Math.sin(p.rot) * L);
          c.stroke();
          break;
        }
        case 'slash': {
          // A claw mark: draws in over the first third of life, then fades.
          const drawn = Math.min(1, (1 - t) * 3);
          c.lineWidth = p.size;
          c.globalAlpha = t < 0.5 ? t * 2 : 1;
          const hx = Math.cos(p.rot) * p.len * 0.5;
          const hy = Math.sin(p.rot) * p.len * 0.5;
          c.beginPath();
          c.moveTo(p.x - hx, p.y - hy);
          c.lineTo(p.x - hx + hx * 2 * drawn, p.y - hy + hy * 2 * drawn);
          c.stroke();
          break;
        }
        case 'arc': {
          // Expanding wave crest facing `rot`.
          const R = p.size * (0.3 + 1.7 * (1 - t));
          c.globalAlpha = t * 0.35;
          c.lineWidth = 10 + 10 * t;
          c.beginPath();
          c.arc(p.x, p.y, R, p.rot - 0.9, p.rot + 0.9);
          c.stroke();
          c.globalAlpha = t;
          c.lineWidth = 4 + 5 * t;
          c.beginPath();
          c.arc(p.x, p.y, R, p.rot - 0.9, p.rot + 0.9);
          c.stroke();
          break;
        }
        case 'glint': {
          // Four-point star.
          const r = p.size * (0.3 + 0.7 * t);
          c.beginPath();
          c.moveTo(p.x, p.y - r);
          c.lineTo(p.x + r * 0.3, p.y - r * 0.3);
          c.lineTo(p.x + r, p.y);
          c.lineTo(p.x + r * 0.3, p.y + r * 0.3);
          c.lineTo(p.x, p.y + r);
          c.lineTo(p.x - r * 0.3, p.y + r * 0.3);
          c.lineTo(p.x - r, p.y);
          c.lineTo(p.x - r * 0.3, p.y - r * 0.3);
          c.closePath();
          c.fill();
          break;
        }
        default:
          c.beginPath();
          c.arc(p.x, p.y, p.size * t, 0, TAU);
          c.fill();
      }
      c.restore();
    }
  }

  burst(x: number, y: number, kind: BurstKind, opts: BurstOpts = {}) {
    const preset = BURST_PRESETS[kind] ?? BURST_PRESETS.hit;
    const count = opts.count ?? preset.count;
    const speed = opts.speed ?? preset.speed;
    const color = opts.color ?? preset.color;
    const gravity = opts.gravity ?? preset.gravity;
    const spread = opts.spread ?? TAU;
    const base = spread >= TAU ? 0 : -Math.PI / 2 - spread / 2;
    for (let i = 0; i < count; i++) {
      const angle = base + Math.random() * spread;
      const v = speed * (0.45 + Math.random() * 0.75);
      const life = 0.35 + Math.random() * 0.45;
      this.spawn({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        life,
        size: 2 + Math.random() * 3,
        color,
        gravity,
        shape: preset.shape
      });
    }
  }

  /* ------------------------------------------------------------ elements -- */

  trail(x0: number, y0: number, x1: number, y1: number, element: FxElement) {
    const col = ELEMENT_COLORS[element] ?? ELEMENT_COLORS.steel;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;
    const n = Math.max(8, Math.round(dist / 7));
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const x = x0 + dx * u + rnd(-4, 4);
      const y = y0 + dy * u + rnd(-4, 4);
      const delay = u * 0.12;
      switch (element) {
        case 'fire':
          this.spawn({ x, y, vx: rnd(-30, 30) - nx * 20, vy: rnd(-110, -30), life: rnd(0.45, 0.8), size: rnd(4, 8), color: i % 3 ? col.a : col.b, gravity: -140, shape: 'ember', add: true, delay });
          if (i % 2 === 0) this.spawn({ x, y, vx: rnd(-10, 10), vy: rnd(-40, -10), life: rnd(0.3, 0.5), size: rnd(6, 10), color: col.deep, gravity: -80, shape: 'mote', delay: delay + 0.05 });
          break;
        case 'water':
        case 'frost':
          this.spawn({ x, y, vx: -ny * rnd(-40, 40) - nx * 10, vy: rnd(-40, 10), life: rnd(0.35, 0.55), size: rnd(2, 4), color: i % 2 ? col.a : col.b, gravity: 420, shape: element === 'frost' ? 'shard' : 'drop', delay });
          break;
        case 'void':
          this.spawn({ x, y, vx: -nx * rnd(20, 60), vy: rnd(-20, 20), life: rnd(0.35, 0.6), size: rnd(2.5, 5), color: i % 2 ? col.a : col.deep, gravity: 0, drag: 0.02, shape: 'mote', add: i % 2 === 0, delay });
          break;
        case 'holy':
          this.spawn({ x, y, vx: rnd(-15, 15), vy: rnd(-40, -10), life: rnd(0.4, 0.6), size: rnd(3, 6), color: i % 2 ? col.a : col.b, shape: 'glint', add: true, delay });
          break;
        case 'beast':
          this.spawn({ x, y, vx: -ny * rnd(-30, 30), vy: rnd(-60, 0), life: rnd(0.3, 0.45), size: rnd(2, 3.5), color: col.a, gravity: 380, shape: 'spark', delay });
          break;
        case 'arcane':
        case 'poison':
          this.spawn({ x, y, vx: rnd(-30, 30), vy: rnd(-50, -10), life: rnd(0.35, 0.6), size: rnd(2, 4.5), color: i % 2 ? col.a : col.b, gravity: element === 'poison' ? 80 : -60, shape: 'mote', add: true, delay });
          break;
        default:
          // steel / metal: bright short streaks along the path
          this.spawn({ x, y, vx: nx * rnd(60, 140) + rnd(-20, 20), vy: ny * rnd(60, 140) + rnd(-30, 30), life: rnd(0.2, 0.35), size: rnd(2, 3.5), color: i % 2 ? col.a : col.b, gravity: 300, shape: 'spark', add: true, delay });
      }
    }
  }

  impact(x: number, y: number, element: FxElement, opts: { scale?: number } = {}) {
    const s = opts.scale ?? 1;
    const col = ELEMENT_COLORS[element] ?? ELEMENT_COLORS.steel;
    switch (element) {
      case 'fire': {
        // Heat ripple + a fountain of embers.
        this.spawn({ x, y, life: 0.5, size: 26 * s, color: col.a, shape: 'ring', add: true });
        this.spawn({ x, y, life: 0.36, size: 14 * s, color: col.b, shape: 'ring', add: true, delay: 0.05 });
        // Core flash + a fountain of embers, with dark smoke behind them.
        this.spawn({ x, y, life: 0.25, size: 22 * s, color: col.b, shape: 'glint', add: true });
        for (let i = 0; i < 30; i++) {
          const a = rnd(0, TAU);
          const v = rnd(70, 220) * s;
          this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 70, life: rnd(0.45, 0.9), size: rnd(4, 8) * s, color: i % 3 ? col.a : col.b, gravity: -170, drag: 0.15, shape: 'ember', add: true });
        }
        for (let i = 0; i < 8; i++) {
          this.spawn({ x: x + rnd(-14, 14), y: y + rnd(-10, 10), vx: rnd(-25, 25), vy: rnd(-70, -30), life: rnd(0.5, 0.8), size: rnd(8, 14) * s, color: col.deep, gravity: -60, shape: 'mote', delay: 0.08 });
        }
        break;
      }
      case 'water':
      case 'frost': {
        // A crest sweeping outward + droplets thrown up and falling.
        for (let k = 0; k < 4; k++) {
          this.spawn({ x, y, life: 0.55, size: (22 + k * 12) * s, color: k % 2 ? col.b : col.a, shape: 'arc', rot: -Math.PI / 2, add: true, delay: k * 0.06 });
        }
        this.spawn({ x, y, life: 0.4, size: 18 * s, color: col.b, shape: 'ring', add: true });
        for (let i = 0; i < 26; i++) {
          const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05);
          const v = rnd(110, 280) * s;
          this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.5, 0.8), size: rnd(3, 6.5) * s, color: i % 2 ? col.a : col.b, gravity: 600, shape: element === 'frost' ? 'shard' : 'drop' });
        }
        break;
      }
      case 'void': {
        // Dark motes rush inward and a ring collapses to a point.
        for (let i = 0; i < 22; i++) {
          const a = rnd(0, TAU);
          const r = rnd(28, 60) * s;
          const life = rnd(0.32, 0.5);
          this.spawn({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: (-Math.cos(a) * r) / life, vy: (-Math.sin(a) * r) / life, life, size: rnd(2.5, 5) * s, color: i % 3 ? col.a : col.deep, shape: 'mote', add: i % 3 !== 0 });
        }
        this.spawn({ x, y, life: 0.4, size: 22 * s, color: col.b, shape: 'ring', add: true });
        break;
      }
      case 'holy': {
        // A fan of golden rays + drifting glints.
        const rays = 10;
        for (let i = 0; i < rays; i++) {
          const a = (i / rays) * TAU + rnd(-0.1, 0.1);
          this.spawn({ x, y, life: 0.5, size: 3 * s, color: i % 2 ? col.a : col.b, shape: 'ray', rot: a, len: rnd(36, 64) * s, add: true, delay: rnd(0, 0.06) });
        }
        for (let i = 0; i < 12; i++) {
          this.spawn({ x: x + rnd(-24, 24) * s, y: y + rnd(-24, 24) * s, vx: rnd(-20, 20), vy: rnd(-50, -15), life: rnd(0.5, 0.9), size: rnd(3, 6) * s, color: col.b, shape: 'glint', add: true, delay: rnd(0, 0.2) });
        }
        this.spawn({ x, y, life: 0.35, size: 14 * s, color: col.b, shape: 'ring', add: true });
        break;
      }
      case 'beast': {
        // Three claw slashes, then a spray.
        const base = rnd(-0.9, -0.5);
        for (let i = 0; i < 3; i++) {
          this.spawn({ x: x + (i - 1) * 11 * s, y: y + (i - 1) * 4 * s, life: 0.5, size: 3.2 * s, color: i === 1 ? col.b : col.a, shape: 'slash', rot: base, len: rnd(44, 60) * s, add: true, delay: i * 0.045 });
        }
        for (let i = 0; i < 10; i++) {
          const a = rnd(0, TAU);
          const v = rnd(80, 200) * s;
          this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.3, 0.5), size: rnd(2, 3.5) * s, color: col.a, gravity: 420, shape: 'spark', delay: 0.06 });
        }
        break;
      }
      case 'metal': {
        for (let i = 0; i < 26; i++) {
          const a = rnd(0, TAU);
          const v = rnd(120, 320) * s;
          this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.25, 0.55), size: rnd(2, 4) * s, color: i % 2 ? col.a : col.b, gravity: 520, shape: 'spark', add: true });
        }
        this.spawn({ x, y, life: 0.28, size: 12 * s, color: col.b, shape: 'ring', add: true });
        break;
      }
      case 'arcane':
      case 'poison': {
        for (let i = 0; i < 18; i++) {
          const a = rnd(0, TAU);
          const v = rnd(50, 160) * s;
          this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.4, 0.7), size: rnd(2.5, 5) * s, color: i % 2 ? col.a : col.b, gravity: element === 'poison' ? 120 : -80, drag: 0.2, shape: 'mote', add: true });
        }
        this.spawn({ x, y, life: 0.4, size: 16 * s, color: col.a, shape: 'ring', add: true });
        break;
      }
      default: {
        // steel: a clean white flash with a few bright chips.
        this.spawn({ x, y, life: 0.3, size: 14 * s, color: col.b, shape: 'ring', add: true });
        this.spawn({ x, y, life: 0.32, size: 12 * s, color: col.b, shape: 'glint', add: true });
        for (let i = 0; i < 10; i++) {
          const a = rnd(0, TAU);
          const v = rnd(90, 220) * s;
          this.spawn({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.2, 0.4), size: rnd(2, 3.5) * s, color: i % 2 ? col.a : col.b, gravity: 380, shape: 'spark', add: true });
        }
      }
    }
  }

  /* ----------------------------------------------------------------- dom -- */

  shake(el: HTMLElement, intensity = 8, ms = 260) {
    el.style.setProperty('--shake-amp', `${intensity}px`);
    el.classList.remove('is-shaking');
    // Force reflow so the animation restarts even on rapid repeat hits.
    void el.offsetWidth;
    el.classList.add('is-shaking');
    window.setTimeout(() => el.classList.remove('is-shaking'), ms);
  }

  float(host: HTMLElement, x: number, y: number, text: string, kind: FloatKind = 'damage') {
    const node = document.createElement('div');
    node.className = `float-num float-${kind}`;
    node.textContent = text;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    host.appendChild(node);
    node.addEventListener('animationend', () => node.remove(), { once: true });
    window.setTimeout(() => node.remove(), 2200);
  }

  flash(color: string, ms = 180) {
    if (!this.flashEl) {
      this.flashEl = document.createElement('div');
      this.flashEl.className = 'screen-flash';
      document.body.appendChild(this.flashEl);
    }
    const el = this.flashEl;
    el.style.background = color;
    el.style.transition = 'none';
    el.style.opacity = '0.55';
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${ms}ms ease-out`;
      el.style.opacity = '0';
    });
  }

  clear() {
    this.particles.length = 0;
  }
}

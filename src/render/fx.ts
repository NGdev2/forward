import type { BurstKind, BurstOpts, FloatKind, FxKit } from './api';

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
  shape: 'circle' | 'spark' | 'ring';
}

const BURST_PRESETS: Record<BurstKind, { color: string; count: number; speed: number; gravity: number; shape: Particle['shape'] }> = {
  hit: { color: '#ffd9a0', count: 12, speed: 190, gravity: 420, shape: 'spark' },
  crit: { color: '#ffe066', count: 22, speed: 300, gravity: 380, shape: 'spark' },
  heal: { color: '#5ee88f', count: 14, speed: 110, gravity: -140, shape: 'circle' },
  coin: { color: '#f2c14e', count: 16, speed: 200, gravity: 620, shape: 'circle' },
  magic: { color: '#a98bff', count: 20, speed: 160, gravity: -60, shape: 'circle' },
  dust: { color: '#6b7280', count: 8, speed: 90, gravity: 160, shape: 'circle' },
  death: { color: '#ff6b81', count: 30, speed: 260, gravity: 300, shape: 'spark' },
  levelup: { color: '#7ee8ff', count: 34, speed: 240, gravity: -120, shape: 'ring' }
};

export class Fx implements FxKit {
  private particles: Particle[] = [];
  private flashEl: HTMLElement | null = null;

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(c: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, t));
      c.fillStyle = p.color;
      c.strokeStyle = p.color;
      if (p.shape === 'spark') {
        c.lineWidth = Math.max(1, p.size * 0.5);
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        c.stroke();
      } else if (p.shape === 'ring') {
        c.lineWidth = 2;
        c.beginPath();
        c.arc(p.x, p.y, p.size * (2 - t), 0, Math.PI * 2);
        c.stroke();
      } else {
        c.beginPath();
        c.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
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
    const spread = opts.spread ?? Math.PI * 2;
    const base = spread >= Math.PI * 2 ? 0 : -Math.PI / 2 - spread / 2;
    for (let i = 0; i < count; i++) {
      const angle = base + Math.random() * spread;
      const v = speed * (0.45 + Math.random() * 0.75);
      const life = 0.35 + Math.random() * 0.45;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        life,
        maxLife: life,
        size: 2 + Math.random() * 3,
        color,
        gravity,
        shape: preset.shape
      });
    }
  }

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
    window.setTimeout(() => node.remove(), 1600);
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

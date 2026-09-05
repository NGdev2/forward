import type { GameContext, Screen, ScreenParams } from '../core/context';
import { lookFromEquipment } from '../render/api';
import { el, listeners, q } from '../ui/dom';
import { button, optionRow, sheet, toggle } from '../ui/components';
import type { SheetHandle } from '../ui/components';

/* ============================================================================
 * Title screen.
 *
 * Three jobs, in priority order:
 *   1. Look like a game worth opening (animated canvas road + logo treatment).
 *   2. Get a returning player back into the run in one tap, while showing them
 *      what they have to lose.
 *   3. Teach a brand-new player the loop in about ten seconds.
 * ========================================================================== */

const HOW_IT_WORKS: { icon: string; title: string; body: string }[] = [
  { icon: '🛣️', title: 'Three roads', body: 'You run forward on your own. Three encounters approach — pick a lane.' },
  { icon: '⚔️', title: 'Fight or take it', body: 'Beasts, shrines, chests and traders. Most of them end in a fight.' },
  { icon: '💎', title: 'Loot and level', body: 'Every win pays gold, xp and gear. Wear the better piece, sell the rest.' },
  { icon: '☠️', title: 'Fill the bar, face the boss', body: 'Each encounter charges the boss meter. Full means the world lord is waiting.' }
];

export class TitleScreen implements Screen {
  readonly id = 'title' as const;

  private ctx!: GameContext;
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private c2d!: CanvasRenderingContext2D;
  private off = listeners();
  private time = 0;
  private stars: { x: number; y: number; r: number; p: number }[] = [];
  private embers: { x: number; y: number; vy: number; vx: number; r: number; a: number }[] = [];
  private ridges: { pts: number[]; y: number; tone: string; drift: number }[] = [];
  private settingsSheet: SheetHandle | null = null;
  private confirmSheet: SheetHandle | null = null;
  private resize?: () => void;

  /* --------------------------------------------------------------- mount -- */

  mount(root: HTMLElement, ctx: GameContext, _params: ScreenParams) {
    this.ctx = ctx;
    const s = ctx.state.stats;
    const returning = s.onboarded || s.bestLevel > 1 || s.bestDistance > 0;

    applyReducedMotion(s.settings.reducedMotion);

    const screen = el('div', { class: 'screen screen-title' });
    this.root = screen;

    this.canvas = el('canvas', { class: 'title-bg' });
    screen.appendChild(this.canvas);
    screen.appendChild(el('div', { class: 'title-vignette' }));

    screen.insertAdjacentHTML(
      'beforeend',
      `
      <div class="title-content">
        <header class="title-head">
          <div class="title-crest">
            <span class="title-crest-rule"></span>
            <span class="title-crest-mark">▲</span>
            <span class="title-crest-rule"></span>
          </div>
          <h1 class="title-logo" data-text="FORWARD"><span>FORWARD</span></h1>
          <p class="title-tag">The road never ends</p>
        </header>

        <div class="title-stage">
          <div class="title-hero" id="title-hero"></div>
          <div class="title-hero-glow"></div>
        </div>

        <div class="title-deck" id="title-deck"></div>

        <footer class="title-foot">
          <button class="btn btn-primary btn-lg btn-block btn-cta" id="title-start">
            <span>${returning ? 'Continue the run' : 'Begin the run'}</span>
          </button>
          <div class="title-actions">
            <button class="icon-btn" id="title-help" aria-label="How to play">?</button>
            <button class="icon-btn" id="title-settings" aria-label="Settings">⚙</button>
          </div>
          <p class="title-version">v0.1 · an endless road</p>
        </footer>
      </div>
      `
    );

    root.appendChild(screen);

    // ---- the deck between the stage and the CTA changes with player history.
    const deck = q(screen, '#title-deck');
    deck.appendChild(returning ? this.buildSaveCard() : this.buildPrimer());

    // ---- hero silhouette standing on the road.
    try {
      const portrait = ctx.sprites.heroPortrait(lookFromEquipment(ctx.state.equipment), 190, 'idle');
      q(screen, '#title-hero').appendChild(portrait);
    } catch {
      /* sprite layer still landing — the scene reads fine without it */
    }

    // ---- wiring.
    this.off.on(q(screen, '#title-start'), 'click', () => this.start());
    this.off.on(q(screen, '#title-help'), 'click', () => this.openHelp());
    this.off.on(q(screen, '#title-settings'), 'click', () => this.openSettings());

    this.setupCanvas();
  }

  /* -------------------------------------------------------------- pieces -- */

  private buildSaveCard(): HTMLElement {
    const s = this.ctx.state.stats;
    const card = el('div', { class: 'panel title-save' });
    card.appendChild(el('div', { class: 'panel-hd' }, 'Your journey'));
    const grid = el('div', { class: 'title-save-grid' });
    const cell = (label: string, value: string, tone: string) =>
      el('div', { class: `title-save-cell ${tone}` }, el('b', { class: 'num' }, value), el('span', {}, label));
    grid.append(
      cell('Level', String(s.level), 'is-accent'),
      cell('World', String(s.worldCycle + 1), 'is-gold'),
      cell('Best run', `${Math.round(s.bestDistance)}m`, 'is-gem')
    );
    card.appendChild(grid);

    const foot = el('div', { class: 'title-save-foot' });
    foot.append(
      el('span', { class: 'chip chip-danger' }, `${s.bossesFelled} boss${s.bossesFelled === 1 ? '' : 'es'} felled`),
      el('span', { class: 'chip' }, `${s.battlesWon} won`),
      el('span', { class: 'chip chip-gold' }, `${s.gold} gold`)
    );
    card.appendChild(foot);
    return card;
  }

  private buildPrimer(): HTMLElement {
    const wrap = el('div', { class: 'title-primer' });
    wrap.appendChild(el('div', { class: 'divider' }, el('span', {}, 'How it works')));
    const list = el('div', { class: 'title-steps' });
    HOW_IT_WORKS.forEach((step, i) => {
      list.appendChild(
        el(
          'div',
          { class: `title-step anim-rise d-${i + 1}` },
          el('span', { class: 'title-step-icon' }, step.icon),
          el(
            'span',
            { class: 'title-step-text' },
            el('b', {}, step.title),
            el('span', {}, step.body)
          )
        )
      );
    });
    wrap.appendChild(list);
    return wrap;
  }

  /* --------------------------------------------------------------- flows -- */

  private start() {
    const ctx = this.ctx;
    ctx.audio.unlock();
    ctx.audio.play('ui_tap');
    ctx.state.stats.onboarded = true;
    ctx.save();
    ctx.goto('run');
  }

  private openHelp() {
    this.ctx.audio.play('ui_tap');
    const s = sheet(this.root, { title: 'How to play' });
    for (const step of HOW_IT_WORKS) {
      s.body.appendChild(
        el(
          'div',
          { class: 'title-step' },
          el('span', { class: 'title-step-icon' }, step.icon),
          el('span', { class: 'title-step-text' }, el('b', {}, step.title), el('span', {}, step.body))
        )
      );
    }
    s.body.appendChild(el('div', { class: 'rule' }));
    s.body.appendChild(
      el(
        'p',
        { class: 'title-help-note' },
        'Health does not refill on its own. Shrines, potions and levelling up are how you stay alive — a careless lane choice at low health ends the run.'
      )
    );
    s.foot.appendChild(button('Got it', { variant: 'primary', block: true, onClick: () => s.destroy() }));
    s.open();
  }

  private openSettings() {
    const ctx = this.ctx;
    ctx.audio.play('ui_tap');
    this.settingsSheet?.destroy();
    const s = sheet(this.root, { title: 'Settings' });
    this.settingsSheet = s;
    const settings = ctx.state.stats.settings;

    s.body.append(
      optionRow(
        'Sound effects',
        'Hits, coins and interface taps.',
        toggle(settings.sfx, next => {
          settings.sfx = next;
          ctx.audio.setEnabled(next);
          if (next) ctx.audio.play('ui_tap');
          ctx.save();
        }, 'Sound effects')
      ),
      optionRow(
        'Music',
        'Ambient score during runs and boss fights.',
        toggle(settings.music, next => {
          settings.music = next;
          ctx.save();
        }, 'Music')
      ),
      optionRow(
        'Reduced motion',
        'Calms screen shake, transitions and background animation.',
        toggle(settings.reducedMotion, next => {
          settings.reducedMotion = next;
          applyReducedMotion(next);
          ctx.save();
        }, 'Reduced motion')
      ),
      optionRow(
        'Auto-equip upgrades',
        'Instantly wear any looted item that beats what you have.',
        toggle(settings.autoEquip, next => {
          settings.autoEquip = next;
          ctx.save();
        }, 'Auto-equip upgrades')
      )
    );

    s.body.appendChild(el('div', { class: 'rule' }));
    s.body.appendChild(el('p', { class: 'section-label' }, 'Danger zone'));
    s.body.appendChild(
      button('Reset all progress', {
        variant: 'danger',
        block: true,
        onClick: () => this.confirmReset()
      })
    );
    s.foot.appendChild(button('Close', { variant: 'ghost', block: true, onClick: () => s.destroy() }));
    s.open();
  }

  private confirmReset() {
    const ctx = this.ctx;
    this.confirmSheet?.destroy();
    const s = sheet(this.root, { title: 'Reset everything?', center: true, closable: false });
    this.confirmSheet = s;
    const stats = ctx.state.stats;
    s.body.appendChild(
      el(
        'p',
        { class: 'title-help-note' },
        `Level ${stats.level}, ${stats.bossesFelled} bosses and every item you own will be destroyed. This cannot be undone.`
      )
    );
    s.foot.append(
      button('Keep playing', { variant: 'ghost', block: true, onClick: () => s.destroy() }),
      button('Reset', {
        variant: 'danger',
        block: true,
        onClick: () => {
          ctx.state.reset();
          ctx.audio.setEnabled(ctx.state.stats.settings.sfx);
          applyReducedMotion(false);
          ctx.save();
          s.destroy();
          this.settingsSheet?.destroy();
          ctx.toast('Progress erased.', 'bad');
          ctx.goto('title');
        }
      })
    );
    s.open();
  }

  /* -------------------------------------------------------------- scenery -- */

  private setupCanvas() {
    const c2d = this.canvas.getContext('2d');
    if (!c2d) return;
    this.c2d = c2d;

    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = this.root.clientWidth || 390;
      const h = this.root.clientHeight || 844;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.seed(w, h);
      this.draw(w, h);
    };
    this.resize = fit;
    window.addEventListener('resize', fit);
    fit();
  }

  /** Builds the static-ish scene contents once per size. */
  private seed(w: number, h: number) {
    const rnd = mulberry(0x5eed);
    this.stars = Array.from({ length: 90 }, () => ({
      x: rnd() * w,
      y: rnd() * h * 0.52,
      r: 0.4 + rnd() * 1.3,
      p: rnd() * Math.PI * 2
    }));
    this.embers = Array.from({ length: 34 }, () => ({
      x: rnd() * w,
      y: rnd() * h,
      vy: -6 - rnd() * 16,
      vx: (rnd() - 0.5) * 7,
      r: 0.7 + rnd() * 1.7,
      a: 0.15 + rnd() * 0.5
    }));

    // Three parallax ridges of broken spires behind the horizon.
    const hy = h * 0.545;
    this.ridges = [0, 1, 2].map(i => {
      const pts: number[] = [];
      const step = 26 + i * 14;
      let x = -60;
      let y = 0;
      while (x < w + 80) {
        y = (rnd() * 0.6 + 0.35) * (34 + i * 26);
        pts.push(x, y);
        x += step * (0.6 + rnd() * 0.9);
      }
      return {
        pts,
        y: hy - i * 6,
        tone: ['rgba(14,18,36,0.95)', 'rgba(20,26,50,0.9)', 'rgba(28,35,66,0.8)'][2 - i],
        drift: (i + 1) * 2.2
      };
    });
  }

  update(dt: number) {
    if (!this.c2d) return;
    const reduced = this.ctx.state.stats.settings.reducedMotion;
    this.time += reduced ? 0 : dt;
    const w = this.root.clientWidth || 390;
    const h = this.root.clientHeight || 844;
    if (!reduced) {
      for (const e of this.embers) {
        e.y += e.vy * dt;
        e.x += e.vx * dt + Math.sin(this.time * 0.8 + e.y * 0.02) * 6 * dt;
        if (e.y < -10) {
          e.y = h + 10;
          e.x = Math.random() * w;
        }
      }
    }
    this.draw(w, h);
  }

  private draw(w: number, h: number) {
    const c = this.c2d;
    if (!c) return;
    const t = this.time;
    const hy = h * 0.545; // horizon
    c.clearRect(0, 0, w, h);

    /* --- sky ------------------------------------------------------------ */
    const sky = c.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, '#05060f');
    sky.addColorStop(0.45, '#0d1230');
    sky.addColorStop(0.78, '#241a45');
    sky.addColorStop(1, '#5a2f4a');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, hy + 1);

    /* --- stars ---------------------------------------------------------- */
    for (const s of this.stars) {
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.7 + s.p));
      c.globalAlpha = tw * (1 - s.y / (h * 0.62)) * 0.9;
      c.fillStyle = '#dfe6ff';
      c.beginPath();
      c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    /* --- moon ----------------------------------------------------------- */
    const mx = w * 0.72;
    const my = hy - h * 0.24;
    const mr = w * 0.19;
    const halo = c.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 3.2);
    halo.addColorStop(0, 'rgba(255,214,170,0.32)');
    halo.addColorStop(0.4, 'rgba(200,120,140,0.12)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = halo;
    c.fillRect(0, 0, w, hy);
    const disc = c.createLinearGradient(mx - mr, my - mr, mx + mr, my + mr);
    disc.addColorStop(0, '#ffe9c9');
    disc.addColorStop(0.55, '#f2c08e');
    disc.addColorStop(1, '#b9748a');
    c.fillStyle = disc;
    c.beginPath();
    c.arc(mx, my, mr, 0, Math.PI * 2);
    c.fill();
    // Craters, drawn as darker discs at low alpha.
    c.globalAlpha = 0.12;
    c.fillStyle = '#5a3550';
    for (const [ox, oy, orr] of [
      [-0.3, -0.2, 0.22],
      [0.22, 0.14, 0.3],
      [-0.05, 0.42, 0.16]
    ]) {
      c.beginPath();
      c.arc(mx + ox * mr, my + oy * mr, orr * mr, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    /* --- ridges --------------------------------------------------------- */
    for (const ridge of this.ridges) {
      const shift = Math.sin(t * 0.06) * ridge.drift;
      c.fillStyle = ridge.tone;
      c.beginPath();
      c.moveTo(-80, hy + 2);
      for (let i = 0; i < ridge.pts.length; i += 2) {
        const px = ridge.pts[i] + shift;
        const py = ridge.y - ridge.pts[i + 1];
        c.lineTo(px, py);
      }
      c.lineTo(w + 80, hy + 2);
      c.closePath();
      c.fill();
    }

    /* --- ground --------------------------------------------------------- */
    const ground = c.createLinearGradient(0, hy, 0, h);
    ground.addColorStop(0, '#0d1024');
    ground.addColorStop(0.4, '#0a0c1c');
    ground.addColorStop(1, '#050610');
    c.fillStyle = ground;
    c.fillRect(0, hy, w, h - hy);

    /* --- road ------------------------------------------------------------
     * A perspective trapezoid. `p` maps a 0..1 depth to a screen ratio; the
     * exponent is what sells the foreshortening. */
    const cx = w * 0.5;
    const nearHalf = w * 0.62;
    const farHalf = w * 0.012;
    const yAt = (p: number) => hy + (h - hy) * p;
    const halfAt = (p: number) => farHalf + (nearHalf - farHalf) * Math.pow(p, 1.55);

    const roadFill = c.createLinearGradient(0, hy, 0, h);
    roadFill.addColorStop(0, '#2b2740');
    roadFill.addColorStop(0.25, '#1b1a2e');
    roadFill.addColorStop(1, '#0b0b16');
    c.fillStyle = roadFill;
    c.beginPath();
    c.moveTo(cx - farHalf, hy);
    c.lineTo(cx + farHalf, hy);
    c.lineTo(cx + nearHalf, h);
    c.lineTo(cx - nearHalf, h);
    c.closePath();
    c.fill();

    // Kerb light along both edges.
    c.strokeStyle = 'rgba(120,140,200,0.16)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx - farHalf, hy);
    c.lineTo(cx - nearHalf, h);
    c.moveTo(cx + farHalf, hy);
    c.lineTo(cx + nearHalf, h);
    c.stroke();

    // Scrolling centre dashes.
    const scroll = (t * 0.32) % 1;
    for (let i = 0; i < 14; i++) {
      const z = (i / 14 + scroll) % 1;
      const p = Math.pow(z, 2.2);
      const p2 = Math.pow(Math.min(1, z + 0.035), 2.2);
      const y0 = yAt(p);
      const y1 = yAt(p2);
      const wdt = Math.max(0.6, halfAt(p) * 0.035);
      c.globalAlpha = 0.16 + p * 0.5;
      c.fillStyle = '#cdb489';
      c.fillRect(cx - wdt, y0, wdt * 2, Math.max(1, y1 - y0));
    }
    c.globalAlpha = 1;

    // Wayside lanterns receding to the vanishing point.
    for (let i = 0; i < 8; i++) {
      const z = (i / 8 + (t * 0.32) % 1) % 1;
      const p = Math.pow(z, 2.2);
      const y = yAt(p) - 26 * p - 4;
      const off = halfAt(p) * 1.12;
      const r = 1.4 + p * 5;
      for (const sx of [cx - off, cx + off]) {
        const g = c.createRadialGradient(sx, y, 0, sx, y, r * 6);
        g.addColorStop(0, `rgba(255,196,107,${0.55 * (0.25 + p)})`);
        g.addColorStop(1, 'rgba(255,150,60,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(sx, y, r * 6, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#ffe3b4';
        c.globalAlpha = 0.3 + p * 0.7;
        c.beginPath();
        c.arc(sx, y, r, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
      }
    }

    /* --- horizon mist ---------------------------------------------------- */
    const mist = c.createLinearGradient(0, hy - h * 0.09, 0, hy + h * 0.07);
    mist.addColorStop(0, 'rgba(120,90,140,0)');
    mist.addColorStop(0.5, `rgba(150,110,160,${0.2 + 0.05 * Math.sin(t * 0.5)})`);
    mist.addColorStop(1, 'rgba(80,60,110,0)');
    c.fillStyle = mist;
    c.fillRect(0, hy - h * 0.09, w, h * 0.16);

    /* --- embers ---------------------------------------------------------- */
    for (const e of this.embers) {
      c.globalAlpha = e.a * (0.4 + 0.6 * Math.abs(Math.sin(t * 1.3 + e.x)));
      c.fillStyle = e.y > hy ? '#ffb96b' : '#8fd6ff';
      c.beginPath();
      c.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  }

  /* ------------------------------------------------------------- unmount -- */

  unmount() {
    if (this.resize) window.removeEventListener('resize', this.resize);
    this.off.dispose();
    this.settingsSheet?.root.remove();
    this.confirmSheet?.root.remove();
    this.settingsSheet = null;
    this.confirmSheet = null;
    this.stars = [];
    this.embers = [];
    this.ridges = [];
  }
}

/* ------------------------------------------------------------------ utils -- */

function applyReducedMotion(on: boolean) {
  document.documentElement.classList.toggle('reduce-motion', on);
}

/** Small deterministic PRNG so the skyline is identical on every launch. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

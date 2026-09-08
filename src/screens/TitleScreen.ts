import type { GameContext, Screen, ScreenParams } from '../core/context';
import { lookFromEquipment } from '../render/api';
import { BOSS_BASES } from '../game/data/bosses';
import { ENEMY_BASES } from '../game/data/enemies';
import type { Language } from '../game/types';
import { el, listeners, q } from '../ui/dom';
import { button, optionRow, segmented, sheet, slider, toggle } from '../ui/components';
import type { SheetHandle } from '../ui/components';
import { LANGUAGES, fmtNum, getLanguage, name as cname, onLanguageChange, setLanguage, t, tn } from '../i18n';

/* ============================================================================
 * Title screen — the front door.
 *
 *   1. Look like a game worth opening: full-bleed animated vista (night road
 *      to a ruined gate, moon, god-rays, parallax ridges, fireflies) with the
 *      hero standing in his actual gear, lit from behind.
 *   2. Continue is one tap away; the journey card shows what's at stake.
 *   3. Everything else (hero, stats, settings, support, help) lives in a
 *      bottom dock and opens as a sheet, so the vista is never buried.
 * ========================================================================== */

const HELP_STEPS: { icon: string; key: string }[] = [
  { icon: '🛣️', key: 'step1' },
  { icon: '⚔️', key: 'step2' },
  { icon: '💎', key: 'step3' },
  { icon: '☠️', key: 'step4' },
  { icon: '🛡️', key: 'step5' }
];

const SUPPORT_TIERS: { icon: string; key: string; price: string }[] = [
  { icon: '☕', key: 'coffee', price: '0.99' },
  { icon: '🍰', key: 'cake', price: '2.99' },
  { icon: '🏆', key: 'trophy', price: '9.99' }
];

interface Star {
  x: number;
  y: number;
  r: number;
  p: number;
}
interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  p: number;
}
interface Ridge {
  pts: number[];
  y: number;
  tone: string;
  drift: number;
}

export class TitleScreen implements Screen {
  readonly id = 'title' as const;

  private ctx!: GameContext;
  private root!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private c2d: CanvasRenderingContext2D | null = null;
  private off = listeners();
  private time = 0;
  private stars: Star[] = [];
  private motes: Mote[] = [];
  private ridges: Ridge[] = [];
  private bossShade: HTMLCanvasElement | null = null;
  private sheets: SheetHandle[] = [];
  private resize?: () => void;
  private unsubLang?: () => void;
  private w = 390;
  private h = 844;

  /* --------------------------------------------------------------- mount -- */

  mount(root: HTMLElement, ctx: GameContext, _params: ScreenParams) {
    this.ctx = ctx;
    this.time = 0;
    this.sheets = [];
    this.bossShade = null;
    const s = ctx.state.stats;

    applyReducedMotion(s.settings.reducedMotion);
    ctx.music.setMode('title');

    const screen = el('div', { class: 'screen screen-title' });
    this.root = screen;

    this.canvas = el('canvas', { class: 'title-bg', 'aria-hidden': 'true' });
    screen.appendChild(this.canvas);
    screen.appendChild(el('div', { class: 'title-vignette' }));

    screen.insertAdjacentHTML(
      'beforeend',
      `
      <div class="title-content">
        <header class="title-head">
          <div class="title-crest">
            <span class="title-crest-rule"></span>
            <span class="title-crest-mark">◆</span>
            <span class="title-crest-rule"></span>
          </div>
          <h1 class="title-logo" data-text="FORWARD"><span>FORWARD</span></h1>
          <p class="title-tag" data-i18n="title.tagline"></p>
        </header>

        <div class="title-stage">
          <div class="title-rim"></div>
          <div class="title-hero" id="title-hero"></div>
          <div class="title-hero-glow"></div>
        </div>

        <div class="title-deck" id="title-deck"></div>

        <footer class="title-foot">
          <button class="btn btn-primary btn-lg btn-block btn-cta" id="title-start"><span id="title-start-label"></span></button>
          <nav class="title-dock" aria-label="Menu">
            <button class="dock-btn" id="dock-hero"><i>🛡️</i><span data-i18n="title.hero"></span></button>
            <button class="dock-btn" id="dock-stats"><i>📜</i><span data-i18n="title.statistics"></span></button>
            <button class="dock-btn" id="dock-settings"><i>⚙️</i><span data-i18n="title.settings"></span></button>
            <button class="dock-btn dock-btn-gold" id="dock-support"><i>💛</i><span data-i18n="title.support"></span></button>
            <button class="dock-btn" id="dock-help"><i>❔</i><span data-i18n="title.how_to_play"></span></button>
          </nav>
          <p class="title-version" data-i18n="title.version"></p>
        </footer>
      </div>
      `
    );
    root.appendChild(screen);

    // ---- hero standing on the road, in his real gear.
    try {
      const portrait = ctx.sprites.heroPortrait(lookFromEquipment(ctx.state.equipment), 236, 'idle');
      q(screen, '#title-hero').appendChild(portrait);
    } catch {
      /* the scene reads fine without the rig */
    }

    this.applyTexts();

    // ---- wiring.
    this.off.on(q(screen, '#title-start'), 'click', () => this.start());
    this.off.on(q(screen, '#dock-hero'), 'click', () => this.tap(() => ctx.goto('inventory', { from: 'title' })));
    this.off.on(q(screen, '#dock-stats'), 'click', () => this.tap(() => this.openStats()));
    this.off.on(q(screen, '#dock-settings'), 'click', () => this.tap(() => this.openSettings()));
    this.off.on(q(screen, '#dock-support'), 'click', () => this.tap(() => this.openSupport()));
    this.off.on(q(screen, '#dock-help'), 'click', () => this.tap(() => this.openHelp()));

    this.unsubLang = onLanguageChange(() => this.applyTexts());
    this.setupCanvas();
  }

  private tap(fn: () => void) {
    this.ctx.audio.play('ui_tap');
    fn();
  }

  /** Re-fills every localised string on the screen (also after a language switch). */
  private applyTexts() {
    const root = this.root;
    const s = this.ctx.state.stats;
    const returning = s.onboarded || s.bestLevel > 1 || s.bestDistance > 0 || s.battlesWon > 0;
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-i18n]'))) {
      const key = node.dataset.i18n;
      if (key) node.textContent = t(key);
    }
    q(root, '#title-start-label').textContent = returning ? t('title.continue') : t('title.begin');
    const deck = q(root, '#title-deck');
    deck.replaceChildren(returning ? this.buildJourneyCard() : this.buildNewRoadCard());
  }

  /* -------------------------------------------------------------- pieces -- */

  private buildJourneyCard(): HTMLElement {
    const s = this.ctx.state.stats;
    const card = el('div', { class: 'journey' });
    card.appendChild(el('div', { class: 'journey-hd' }, el('span', {}, t('title.journey')), el('i', { class: 'journey-rule' })));
    const grid = el('div', { class: 'journey-grid' });
    const cell = (label: string, value: string, tone: string) =>
      el('div', { class: `journey-cell ${tone}` }, el('b', { class: 'num' }, value), el('span', {}, label));
    grid.append(
      cell(t('common.level'), String(s.level), 'is-accent'),
      cell(t('common.world'), String((s.worldCycle ?? 0) + 1), 'is-gold'),
      cell(t('title.best_run'), t('common.meters', { n: fmtNum(Math.round(s.bestDistance ?? 0)) }), 'is-gem')
    );
    card.appendChild(grid);
    const foot = el('div', { class: 'journey-foot' });
    foot.append(
      el('span', { class: 'chip chip-danger' }, tn('title.bosses_felled', s.bossesFelled ?? 0)),
      el('span', { class: 'chip' }, tn('title.battles_won', s.battlesWon ?? 0)),
      el('span', { class: 'chip chip-gold' }, t('title.gold_amount', { n: fmtNum(s.gold ?? 0) }))
    );
    card.appendChild(foot);
    return card;
  }

  private buildNewRoadCard(): HTMLElement {
    const card = el('div', { class: 'journey journey-new' });
    card.appendChild(el('div', { class: 'journey-hd' }, el('span', {}, t('title.new_journey')), el('i', { class: 'journey-rule' })));
    card.appendChild(el('p', { class: 'journey-sub' }, t('title.new_journey_sub')));
    return card;
  }

  /* --------------------------------------------------------------- flows -- */

  private start() {
    const ctx = this.ctx;
    ctx.audio.unlock();
    ctx.music.unlock();
    ctx.audio.play('ui_tap');
    ctx.state.stats.onboarded = true;
    ctx.save();
    ctx.goto('run');
  }

  private openSheet(opts: Parameters<typeof sheet>[1]): SheetHandle {
    const s = sheet(this.root, opts);
    this.sheets.push(s);
    return s;
  }

  /* ---- how to play ---- */

  private openHelp() {
    const s = this.openSheet({ title: t('help.title') });
    for (const step of HELP_STEPS) {
      s.body.appendChild(
        el(
          'div',
          { class: 'title-step' },
          el('span', { class: 'title-step-icon' }, step.icon),
          el('span', { class: 'title-step-text' }, el('b', {}, t(`help.${step.key}_title`)), el('span', {}, t(`help.${step.key}_body`)))
        )
      );
    }
    s.body.appendChild(el('div', { class: 'rule' }));
    s.body.appendChild(el('p', { class: 'title-help-note' }, t('help.note')));
    s.foot.appendChild(button(t('common.got_it'), { variant: 'primary', block: true, onClick: () => s.destroy() }));
    s.open();
  }

  /* ---- statistics ---- */

  private openStats() {
    const st = this.ctx.state.stats;
    const s = this.openSheet({ title: t('stats.title') });
    const num = (v: number | undefined) => fmtNum(Math.round(v ?? 0));

    const section = (label: string, rows: [string, string, string?][]) => {
      s.body.appendChild(el('p', { class: 'section-label stats-label' }, label));
      const grid = el('div', { class: 'stats-grid' });
      for (const [icon, name, value] of rows) {
        grid.appendChild(
          el('div', { class: 'stats-tile' }, el('i', {}, icon), el('b', { class: 'num' }, value ?? '0'), el('span', {}, name))
        );
      }
      s.body.appendChild(grid);
    };

    section(t('stats.section_combat'), [
      ['☠️', t('stats.kills'), num(st.kills)],
      ['👑', t('stats.bosses_felled'), num(st.bossesFelled)],
      ['🏆', t('stats.battles_won'), num(st.battlesWon)],
      ['🛡️', t('stats.perfect_parries'), num(st.perfectParries)],
      ['💀', t('stats.fights_lost'), num(st.fightsLost)],
      ['🩸', t('stats.bosses_lost'), num(st.bossesLost)]
    ]);
    section(t('stats.section_records'), [
      ['⚔️', t('stats.damage_dealt'), num(st.damageDealt)],
      ['💔', t('stats.damage_taken'), num(st.damageTaken)],
      ['🪙', t('stats.gold_earned'), num(st.goldEarned)]
    ]);
    section(t('stats.section_progress'), [
      ['⭐', t('stats.best_level'), num(st.bestLevel)],
      ['🌍', t('stats.best_world'), num((st.bestCycle ?? 0) + 1)],
      ['🛣️', t('stats.best_distance'), t('common.meters', { n: num(st.bestDistance) })]
    ]);

    // Top five most-killed enemies, with their portraits.
    s.body.appendChild(el('p', { class: 'section-label stats-label' }, t('stats.top_kills')));
    const top = Object.entries(st.killsById ?? {})
      .filter(([, n]) => (n ?? 0) > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (!top.length) {
      s.body.appendChild(el('p', { class: 'title-help-note' }, t('stats.top_kills_empty')));
    } else {
      const list = el('div', { class: 'hunt-list' });
      const max = top[0][1];
      top.forEach(([id, count], i) => {
        const row = el('div', { class: 'hunt-row' });
        const face = el('div', { class: 'hunt-face' });
        try {
          face.appendChild(this.ctx.sprites.creaturePortrait(id, 44));
        } catch {
          face.textContent = enemyIcon(id);
        }
        const bar = el('div', { class: 'hunt-bar' }, el('i', { style: `width:${Math.max(6, (count / max) * 100)}%` }));
        row.append(
          el('span', { class: 'hunt-rank num' }, `${i + 1}`),
          face,
          el('div', { class: 'hunt-text' }, el('b', {}, enemyName(id)), bar),
          el('b', { class: 'hunt-count num' }, num(count))
        );
        list.appendChild(row);
      });
      s.body.appendChild(list);
    }

    s.foot.appendChild(button(t('common.close'), { variant: 'ghost', block: true, onClick: () => s.destroy() }));
    s.open();
  }

  /* ---- support ---- */

  private openSupport() {
    const ctx = this.ctx;
    const s = this.openSheet({ title: t('support.title') });
    s.body.appendChild(el('p', { class: 'title-help-note' }, t('support.blurb')));
    const tiers = el('div', { class: 'tip-list' });
    for (const tier of SUPPORT_TIERS) {
      const b = el(
        'button',
        { type: 'button', class: `tip tip-${tier.key}` },
        el('span', { class: 'tip-icon' }, tier.icon),
        el('span', { class: 'tip-text' }, el('b', {}, t(`support.tier_${tier.key}`)), el('span', {}, t(`support.tier_${tier.key}_sub`))),
        el('span', { class: 'tip-price' }, el('b', { class: 'num' }, `$${tier.price}`), el('span', {}, t('common.coming_soon')))
      );
      b.addEventListener('click', () => {
        ctx.audio.play('coin');
        ctx.toast(t('support.toast'), 'good');
      });
      tiers.appendChild(b);
    }
    s.body.appendChild(tiers);
    s.body.appendChild(el('p', { class: 'tip-thanks' }, t('support.thanks')));
    s.body.appendChild(el('p', { class: 'tip-note' }, t('support.coming_soon_note')));
    s.foot.appendChild(button(t('common.close'), { variant: 'ghost', block: true, onClick: () => s.destroy() }));
    s.open();
  }

  /* ---- settings ---- */

  private openSettings() {
    const s = this.openSheet({ title: t('settings.title') });
    this.renderSettings(s);
    s.open();
  }

  private renderSettings(s: SheetHandle) {
    const ctx = this.ctx;
    const settings = ctx.state.stats.settings;
    s.body.replaceChildren();
    s.foot.replaceChildren();

    // Rebuilding the whole sheet body is the simplest way to re-localise it.
    const hd = s.root.querySelector('.sheet-hd');
    if (hd && hd.firstChild && hd.firstChild.nodeType === Node.TEXT_NODE) hd.firstChild.textContent = t('settings.title');

    s.body.appendChild(
      optionRow(
        t('settings.language'),
        t('settings.language_desc'),
        segmented(
          LANGUAGES.map(l => ({ id: l.id, label: l.id.toUpperCase() })),
          getLanguage(),
          (lang: Language) => {
            settings.language = lang;
            ctx.save();
            setLanguage(lang);
            ctx.audio.play('ui_tap');
            this.renderSettings(s);
          },
          t('settings.language')
        )
      )
    );

    s.body.appendChild(el('p', { class: 'section-label settings-label' }, t('settings.section_audio')));
    s.body.appendChild(
      optionRow(
        t('settings.music'),
        t('settings.music_desc'),
        toggle(
          settings.music,
          next => {
            settings.music = next;
            ctx.music.setEnabled(next);
            if (next) ctx.music.unlock();
            ctx.save();
          },
          t('settings.music')
        )
      )
    );
    s.body.appendChild(
      slider(t('settings.music_volume'), Math.round((settings.musicVolume ?? 0.6) * 100), {
        onInput: v => {
          settings.musicVolume = v / 100;
          ctx.music.setVolume(v / 100);
        },
        onChange: () => ctx.save()
      }).root
    );
    s.body.appendChild(
      optionRow(
        t('settings.sfx'),
        t('settings.sfx_desc'),
        toggle(
          settings.sfx,
          next => {
            settings.sfx = next;
            ctx.audio.setEnabled(next);
            if (next) ctx.audio.play('ui_tap');
            ctx.save();
          },
          t('settings.sfx')
        )
      )
    );
    s.body.appendChild(
      slider(t('settings.sfx_volume'), Math.round((settings.sfxVolume ?? 0.8) * 100), {
        onInput: v => {
          settings.sfxVolume = v / 100;
          ctx.audio.setVolume(v / 100);
        },
        onChange: () => {
          ctx.audio.play('ui_tap');
          ctx.save();
        }
      }).root
    );

    s.body.appendChild(el('p', { class: 'section-label settings-label' }, t('settings.section_play')));
    s.body.append(
      optionRow(
        t('settings.reduced_motion'),
        t('settings.reduced_motion_desc'),
        toggle(
          settings.reducedMotion,
          next => {
            settings.reducedMotion = next;
            applyReducedMotion(next);
            ctx.save();
          },
          t('settings.reduced_motion')
        )
      ),
      optionRow(
        t('settings.auto_equip'),
        t('settings.auto_equip_desc'),
        toggle(
          settings.autoEquip,
          next => {
            settings.autoEquip = next;
            ctx.save();
          },
          t('settings.auto_equip')
        )
      )
    );

    s.body.appendChild(el('p', { class: 'section-label settings-label is-danger' }, t('settings.section_danger')));
    s.body.appendChild(button(t('settings.reset'), { variant: 'danger', block: true, onClick: () => this.confirmReset(s) }));
    s.foot.appendChild(button(t('common.close'), { variant: 'ghost', block: true, onClick: () => s.destroy() }));
  }

  private confirmReset(settingsSheet: SheetHandle) {
    const ctx = this.ctx;
    const stats = ctx.state.stats;
    const s = this.openSheet({ title: t('settings.reset_title'), center: true, closable: false });
    s.body.appendChild(
      el('p', { class: 'title-help-note' }, t('settings.reset_body', { level: stats.level, bosses: stats.bossesFelled ?? 0 }))
    );
    s.foot.append(
      button(t('settings.reset_keep'), { variant: 'ghost', block: true, onClick: () => s.destroy() }),
      button(t('settings.reset_confirm'), {
        variant: 'danger',
        block: true,
        onClick: () => {
          const lang = stats.settings.language;
          ctx.state.reset();
          ctx.state.stats.settings.language = lang; // language is a device preference, not progress
          ctx.audio.setEnabled(ctx.state.stats.settings.sfx);
          ctx.audio.setVolume(ctx.state.stats.settings.sfxVolume);
          ctx.music.setEnabled(ctx.state.stats.settings.music);
          ctx.music.setVolume(ctx.state.stats.settings.musicVolume);
          applyReducedMotion(false);
          ctx.save();
          s.destroy();
          settingsSheet.destroy();
          ctx.toast(t('settings.reset_done'), 'bad');
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
      this.w = w;
      this.h = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.seed(w, h);
      this.draw();
    };
    this.resize = fit;
    window.addEventListener('resize', fit);
    fit();
  }

  /** Builds the static-ish scene contents once per size. */
  private seed(w: number, h: number) {
    const rnd = mulberry(0x5eed);
    this.stars = Array.from({ length: 110 }, () => ({
      x: rnd() * w,
      y: rnd() * h * 0.5,
      r: 0.35 + rnd() * 1.4,
      p: rnd() * Math.PI * 2
    }));
    this.motes = Array.from({ length: 42 }, () => ({
      x: rnd() * w,
      y: rnd() * h,
      vy: -5 - rnd() * 14,
      vx: (rnd() - 0.5) * 8,
      r: 0.7 + rnd() * 1.8,
      a: 0.15 + rnd() * 0.55,
      p: rnd() * Math.PI * 2
    }));

    const hy = h * 0.56;
    this.ridges = [0, 1, 2].map(i => {
      const pts: number[] = [];
      const step = 22 + i * 16;
      let x = -80;
      while (x < w + 100) {
        const spire = rnd() < 0.18;
        pts.push(x, (rnd() * 0.6 + 0.3) * (30 + i * 28) * (spire ? 1.6 : 1));
        x += step * (0.5 + rnd() * 0.9);
      }
      return {
        pts,
        y: hy - i * 7,
        tone: ['rgba(12,15,32,0.97)', 'rgba(19,24,48,0.92)', 'rgba(30,36,70,0.82)'][2 - i],
        drift: (i + 1) * 2.4
      };
    });

    // A shadow of the boss who waits at the end of this stretch of road.
    try {
      const boss = BOSS_BASES[(this.ctx.state.stats.worldCycle ?? 0) % BOSS_BASES.length];
      const src = this.ctx.sprites.creaturePortrait(boss.id, 160);
      const shade = document.createElement('canvas');
      shade.width = src.width;
      shade.height = src.height;
      const g = shade.getContext('2d');
      if (g) {
        g.drawImage(src, 0, 0);
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = '#0a0c1c';
        g.fillRect(0, 0, shade.width, shade.height);
      }
      this.bossShade = shade;
    } catch {
      this.bossShade = null;
    }
  }

  update(dt: number) {
    if (!this.c2d) return;
    const reduced = this.ctx.state.stats.settings.reducedMotion;
    if (reduced) return; // the first draw() stays on screen as a still.
    this.time += dt;
    const { w, h } = this;
    for (const m of this.motes) {
      m.y += m.vy * dt;
      m.x += m.vx * dt + Math.sin(this.time * 0.8 + m.p) * 7 * dt;
      if (m.y < -10) {
        m.y = h + 10;
        m.x = Math.random() * w;
      }
    }
    this.draw();
  }

  private draw() {
    const c = this.c2d;
    if (!c) return;
    const { w, h } = this;
    const t = this.time;
    const hy = h * 0.56; // horizon
    c.clearRect(0, 0, w, h);

    /* --- sky ------------------------------------------------------------ */
    const sky = c.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, '#04050e');
    sky.addColorStop(0.4, '#0b1030');
    sky.addColorStop(0.72, '#22194a');
    sky.addColorStop(0.9, '#4a2c55');
    sky.addColorStop(1, '#7a4a4e');
    c.fillStyle = sky;
    c.fillRect(0, 0, w, hy + 1);

    /* --- stars ---------------------------------------------------------- */
    c.fillStyle = '#e4ebff';
    for (const s of this.stars) {
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(t * 0.7 + s.p));
      c.globalAlpha = tw * (1 - s.y / (h * 0.6)) * 0.95;
      c.beginPath();
      c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    /* --- moon + halo ---------------------------------------------------- */
    const mx = w * 0.74;
    const my = hy - h * 0.27;
    const mr = w * 0.15;
    const halo = c.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
    halo.addColorStop(0, 'rgba(255,220,180,0.34)');
    halo.addColorStop(0.35, 'rgba(210,130,150,0.13)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = halo;
    c.fillRect(0, 0, w, hy);

    /* --- god rays: slow-turning wedges from the moon, clipped to the sky -- */
    c.save();
    c.beginPath();
    c.rect(0, 0, w, hy);
    c.clip();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const ang = Math.PI * 0.55 + i * 0.19 + Math.sin(t * 0.08 + i) * 0.05;
      const len = h * 0.9;
      const spread = 0.045 + (i % 3) * 0.02;
      const g = c.createLinearGradient(mx, my, mx + Math.cos(ang) * len, my + Math.sin(ang) * len);
      const a = 0.05 + 0.03 * Math.abs(Math.sin(t * 0.25 + i * 1.7));
      g.addColorStop(0, `rgba(255,214,170,${a})`);
      g.addColorStop(1, 'rgba(255,214,170,0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(mx, my);
      c.lineTo(mx + Math.cos(ang - spread) * len, my + Math.sin(ang - spread) * len);
      c.lineTo(mx + Math.cos(ang + spread) * len, my + Math.sin(ang + spread) * len);
      c.closePath();
      c.fill();
    }
    c.restore();

    const disc = c.createLinearGradient(mx - mr, my - mr, mx + mr, my + mr);
    disc.addColorStop(0, '#fff1d6');
    disc.addColorStop(0.55, '#f5c793');
    disc.addColorStop(1, '#c07f8e');
    c.fillStyle = disc;
    c.beginPath();
    c.arc(mx, my, mr, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 0.13;
    c.fillStyle = '#5a3550';
    for (const [ox, oy, orr] of [
      [-0.3, -0.2, 0.22],
      [0.22, 0.14, 0.3],
      [-0.05, 0.42, 0.16],
      [0.4, -0.45, 0.12]
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
      c.moveTo(-100, hy + 2);
      for (let i = 0; i < ridge.pts.length; i += 2) c.lineTo(ridge.pts[i] + shift, ridge.y - ridge.pts[i + 1]);
      c.lineTo(w + 100, hy + 2);
      c.closePath();
      c.fill();
    }

    /* --- horizon glow (the road leads somewhere lit) -------------------- */
    const glow = c.createRadialGradient(w * 0.5, hy, 0, w * 0.5, hy, w * 0.42);
    glow.addColorStop(0, `rgba(255,170,110,${0.42 + 0.06 * Math.sin(t * 0.6)})`);
    glow.addColorStop(0.5, 'rgba(200,110,120,0.14)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(0, hy - w * 0.42, w, w * 0.42);

    /* --- ground --------------------------------------------------------- */
    const ground = c.createLinearGradient(0, hy, 0, h);
    ground.addColorStop(0, '#171532');
    ground.addColorStop(0.35, '#0b0d20');
    ground.addColorStop(1, '#04050d');
    c.fillStyle = ground;
    c.fillRect(0, hy, w, h - hy);

    /* --- road: perspective trapezoid ------------------------------------ */
    const cx = w * 0.5;
    const nearHalf = w * 0.7;
    const farHalf = w * 0.014;
    const yAt = (p: number) => hy + (h - hy) * p;
    const halfAt = (p: number) => farHalf + (nearHalf - farHalf) * Math.pow(p, 1.5);

    const roadFill = c.createLinearGradient(0, hy, 0, h);
    roadFill.addColorStop(0, '#3a2f4c');
    roadFill.addColorStop(0.2, '#1e1b33');
    roadFill.addColorStop(1, '#0a0a16');
    c.fillStyle = roadFill;
    c.beginPath();
    c.moveTo(cx - farHalf, hy);
    c.lineTo(cx + farHalf, hy);
    c.lineTo(cx + nearHalf, h);
    c.lineTo(cx - nearHalf, h);
    c.closePath();
    c.fill();

    // Flagstones: faint cross-lines receding with perspective.
    c.strokeStyle = 'rgba(160,150,200,0.07)';
    c.lineWidth = 1;
    const scroll = (t * 0.28) % 1;
    for (let i = 0; i < 12; i++) {
      const z = (i / 12 + scroll) % 1;
      const p = Math.pow(z, 2.4);
      const y = yAt(p);
      const half = halfAt(p);
      c.beginPath();
      c.moveTo(cx - half, y);
      c.lineTo(cx + half, y);
      c.stroke();
    }

    // Kerb light along both edges.
    c.strokeStyle = 'rgba(140,160,220,0.2)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(cx - farHalf, hy);
    c.lineTo(cx - nearHalf, h);
    c.moveTo(cx + farHalf, hy);
    c.lineTo(cx + nearHalf, h);
    c.stroke();

    // Scrolling centre dashes.
    c.fillStyle = '#d6bd8f';
    for (let i = 0; i < 14; i++) {
      const z = (i / 14 + scroll) % 1;
      const p = Math.pow(z, 2.2);
      const p2 = Math.pow(Math.min(1, z + 0.035), 2.2);
      const y0 = yAt(p);
      const y1 = yAt(p2);
      const wdt = Math.max(0.6, halfAt(p) * 0.03);
      c.globalAlpha = 0.14 + p * 0.45;
      c.fillRect(cx - wdt, y0, wdt * 2, Math.max(1, y1 - y0));
    }
    c.globalAlpha = 1;

    /* --- ruined gate at the vanishing point, the boss waiting inside ---- */
    this.drawGate(c, cx, hy, w, h, t);

    /* --- wayside lanterns receding to the gate ------------------------- */
    for (let i = 0; i < 8; i++) {
      const z = (i / 8 + scroll) % 1;
      const p = Math.pow(z, 2.2);
      const y = yAt(p) - 30 * p - 4;
      const off = halfAt(p) * 1.14;
      const r = 1.2 + p * 5;
      for (const sx of [cx - off, cx + off]) {
        const g = c.createRadialGradient(sx, y, 0, sx, y, r * 7);
        g.addColorStop(0, `rgba(255,196,107,${0.55 * (0.25 + p)})`);
        g.addColorStop(1, 'rgba(255,150,60,0)');
        c.fillStyle = g;
        c.beginPath();
        c.arc(sx, y, r * 7, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#ffe3b4';
        c.globalAlpha = 0.3 + p * 0.7;
        c.beginPath();
        c.arc(sx, y, r, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
        // Lantern post.
        if (p > 0.08) {
          c.strokeStyle = `rgba(20,18,30,${0.5 + p * 0.5})`;
          c.lineWidth = 1 + p * 3;
          c.beginPath();
          c.moveTo(sx, y + r);
          c.lineTo(sx, y + r + 12 + p * 60);
          c.stroke();
        }
      }
    }

    /* --- horizon mist ---------------------------------------------------- */
    const mist = c.createLinearGradient(0, hy - h * 0.08, 0, hy + h * 0.08);
    mist.addColorStop(0, 'rgba(150,100,150,0)');
    mist.addColorStop(0.5, `rgba(170,120,170,${0.2 + 0.05 * Math.sin(t * 0.5)})`);
    mist.addColorStop(1, 'rgba(80,60,110,0)');
    c.fillStyle = mist;
    c.fillRect(0, hy - h * 0.08, w, h * 0.16);

    /* --- fireflies (sky) and embers (road) ------------------------------ */
    for (const m of this.motes) {
      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.4 + m.p));
      c.globalAlpha = m.a * pulse;
      c.fillStyle = m.y > hy ? '#ffbb6b' : '#9fe0ff';
      c.beginPath();
      c.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      c.fill();
      if (m.r > 1.8) {
        c.globalAlpha = m.a * pulse * 0.25;
        c.beginPath();
        c.arc(m.x, m.y, m.r * 3, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.globalAlpha = 1;
  }

  /** Two broken pillars and a cracked arch at the vanishing point. */
  private drawGate(c: CanvasRenderingContext2D, cx: number, hy: number, w: number, h: number, t: number) {
    const gw = w * 0.075; // half width
    const gh = h * 0.085;
    const base = hy + 1;

    // Light spilling through the gate.
    const spill = c.createRadialGradient(cx, base - gh * 0.4, 0, cx, base - gh * 0.4, gw * 2.2);
    spill.addColorStop(0, `rgba(255,190,120,${0.5 + 0.08 * Math.sin(t * 0.9)})`);
    spill.addColorStop(1, 'rgba(255,190,120,0)');
    c.fillStyle = spill;
    c.fillRect(cx - gw * 2.2, base - gh * 0.4 - gw * 2.2, gw * 4.4, gw * 4.4);

    // The boss silhouette stands in the opening, breathing.
    if (this.bossShade) {
      const size = gh * 0.95 * (1 + 0.02 * Math.sin(t * 1.1));
      c.globalAlpha = 0.9;
      c.drawImage(this.bossShade, cx - size / 2, base - size * 0.98, size, size);
      c.globalAlpha = 1;
    }

    c.fillStyle = '#07091a';
    // Left pillar (taller, broken at the top).
    c.beginPath();
    c.moveTo(cx - gw, base);
    c.lineTo(cx - gw, base - gh * 0.95);
    c.lineTo(cx - gw * 0.8, base - gh * 1.05);
    c.lineTo(cx - gw * 0.62, base - gh * 0.9);
    c.lineTo(cx - gw * 0.55, base);
    c.closePath();
    c.fill();
    // Right pillar (shorter).
    c.beginPath();
    c.moveTo(cx + gw * 0.55, base);
    c.lineTo(cx + gw * 0.6, base - gh * 0.8);
    c.lineTo(cx + gw * 0.82, base - gh * 0.72);
    c.lineTo(cx + gw, base - gh * 0.55);
    c.lineTo(cx + gw, base);
    c.closePath();
    c.fill();
    // Remains of the arch, reaching from the left pillar.
    c.beginPath();
    c.moveTo(cx - gw * 0.66, base - gh * 0.9);
    c.quadraticCurveTo(cx - gw * 0.2, base - gh * 1.22, cx + gw * 0.18, base - gh * 1.02);
    c.lineTo(cx + gw * 0.08, base - gh * 0.92);
    c.quadraticCurveTo(cx - gw * 0.2, base - gh * 1.06, cx - gw * 0.58, base - gh * 0.82);
    c.closePath();
    c.fill();
  }

  /* ------------------------------------------------------------- unmount -- */

  unmount() {
    if (this.resize) window.removeEventListener('resize', this.resize);
    this.unsubLang?.();
    this.unsubLang = undefined;
    this.off.dispose();
    for (const s of this.sheets) s.root.remove();
    this.sheets = [];
    this.stars = [];
    this.motes = [];
    this.ridges = [];
    this.bossShade = null;
    this.c2d = null;
  }
}

/* ------------------------------------------------------------------ utils -- */

function applyReducedMotion(on: boolean) {
  document.documentElement.classList.toggle('reduce-motion', on);
}

function enemyName(id: string): string {
  const enemy = ENEMY_BASES.find(e => e.id === id);
  if (enemy) return cname('enemy', id, enemy.name);
  const boss = BOSS_BASES.find(b => b.id === id);
  if (boss) return cname('boss', id, boss.name);
  return id.replace(/^[eb]_/, '');
}

function enemyIcon(id: string): string {
  return ENEMY_BASES.find(e => e.id === id)?.icon ?? BOSS_BASES.find(b => b.id === id)?.icon ?? '👾';
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

import type { GameContext, RewardParams, Screen, ScreenParams } from '../core/context';
import {
  bossNode,
  generateChoices,
  rememberChoice,
  resolveMystery,
  runMemory,
  type RunEncounter
} from '../game/encounters';
import { pickBoss } from '../game/data/bosses';
import { biomeFor } from './run/biomes';
import { RunScene } from './run/scene';
import { field as cfield, name as cname, t } from '../i18n';

/* ============================================================================
 * The run screen: you are travelling down a road and you can SEE what is
 * coming. Three lanes, three encounters approaching out of the fog; tap one
 * and the hero swerves into it. When the boss bar fills the road is blocked
 * and there is no choice left to make.
 * ========================================================================== */

const SPAWN_DELAY = 0.9;
const ARRIVE_HOLD = 0.42;

/** Biome shown on the previous visit, so entering new country gets a toast. */
let lastBiomeId: string | null = null;

export class RunScreen implements Screen {
  readonly id = 'run' as const;

  private ctx!: GameContext;
  private el!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  private scene!: RunScene;
  private ro?: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private timers: number[] = [];

  private spawnIn = SPAWN_DELAY;
  private navigating = false;
  private hudDirty = true;
  private wasChoosing = false;

  // Cached HUD nodes.
  private q!: (sel: string) => HTMLElement;
  private lastGold = -1;
  private lastHp = -1;

  mount(root: HTMLElement, ctx: GameContext, _params: ScreenParams) {
    this.ctx = ctx;
    // Screens are singletons registered once, so every per-visit field has to
    // be reset here — otherwise the second run inherits `navigating` from the
    // first and the road never spawns another choice.
    this.spawnIn = SPAWN_DELAY;
    this.navigating = false;
    this.hudDirty = true;
    this.wasChoosing = false;
    this.lastGold = -1;
    this.lastHp = -1;
    const biome = biomeFor(ctx.state.stats.worldCycle);

    const el = document.createElement('div');
    el.className = 'screen screen-run';
    el.innerHTML = this.template(cname('biome', biome.id, biome.name));
    root.appendChild(el);
    this.el = el;
    this.q = (sel: string) => el.querySelector(sel) as HTMLElement;

    this.canvas = el.querySelector('.run-canvas') as HTMLCanvasElement;
    this.scene = new RunScene(this.canvas, ctx);
    this.scene.onArrive = node => this.resolve(node);
    this.scene.onCommit = node => this.onCommit(node);
    this.scene.resize();

    this.ro = new ResizeObserver(() => this.scene.resize());
    this.ro.observe(el);

    // Taps anywhere on the world choose a lane (or charge the boss).
    const onTap = (e: PointerEvent) => {
      if (this.navigating) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (this.scene.phase === 'boss') {
        this.scene.urge();
        return;
      }
      const lane = this.scene.laneAtPoint(x, y);
      if (lane == null) return;
      const node = this.scene.choose(lane);
      if (node) {
        ctx.audio.play('swoosh');
        ctx.fx.float(this.el, x, y - 20, node.title, node.danger >= 2 ? 'status' : 'xp');
      }
    };
    this.canvas.addEventListener('pointerdown', onTap);
    this.cleanups.push(() => this.canvas.removeEventListener('pointerdown', onTap));

    // The trader is only reached from the road (the Trader lane), so there is
    // deliberately no shop button up here — just the bag.
    this.bind('.run-bag', () => ctx.goto('inventory', { from: 'run' }));

    ctx.music.setMode('run');

    // New country: say where we are, once per biome change.
    if (lastBiomeId !== biome.id) {
      const first = lastBiomeId === null;
      lastBiomeId = biome.id;
      this.timers.push(
        window.setTimeout(
          () =>
            ctx.toast(
              t('run.biome_toast', { name: cname('biome', biome.id, biome.name), flavor: cfield('biome', biome.id, 'flavor', biome.flavor) }),
              'info'
            ),
          first ? 500 : 250
        )
      );
    }

    // Immediately show the boss if the bar is already full.
    if (ctx.state.isBossReady()) {
      this.startBoss();
    }
    this.syncHud(true);
  }

  private template(biomeName: string): string {
    return `
      <canvas class="run-canvas"></canvas>
      <div class="run-hud">
        <div class="run-top topbar">
          <div class="run-hero-chip">
            <span class="run-lvl">1</span>
            <div class="run-hero-meta">
              <div class="run-xp bar bar-xp"><i class="bar-fill"></i></div>
              <div class="run-hp bar bar-hp"><i class="bar-fill"></i><b class="run-hp-txt">0/0</b></div>
            </div>
          </div>
          <div class="run-purse">
            <span class="chip run-gold"><i>🪙</i><b>0</b></span>
            <span class="chip run-gems"><i>💎</i><b>0</b></span>
          </div>
          <div class="run-actions">
            <button class="icon-btn btn btn-ghost run-bag" aria-label="${esc(t('common.bag'))}">🎒</button>
          </div>
        </div>
        <div class="run-boss">
          <div class="run-boss-label"><span class="run-boss-name">${esc(t('run.road_ahead'))}</span><span class="run-boss-count">0/0</span></div>
          <div class="run-boss-bar bar bar-boss"><i class="bar-fill"></i></div>
        </div>
        <div class="run-mid">
          <span class="run-biome">${esc(biomeName)}</span>
        </div>
        <div class="run-bottom">
          <span class="chip run-dist">0 m</span>
          <span class="run-choose">
            <span class="run-timer" aria-hidden="true"><i></i></span>
            <span class="run-hint">${esc(t('run.tap_lane'))}</span>
          </span>
        </div>
        <div class="run-lanes" aria-hidden="true">
          <div class="run-lane"></div><div class="run-lane"></div><div class="run-lane"></div>
        </div>
      </div>
      <div class="run-boss-warn"><span>${esc(t('run.blocked'))}</span></div>
    `;
  }

  private bind(sel: string, fn: () => void) {
    const node = this.el.querySelector(sel) as HTMLElement | null;
    if (!node) return;
    const handler = (e: Event) => {
      e.stopPropagation();
      if (this.navigating) return;
      this.ctx.audio.play('ui_tap');
      fn();
    };
    node.addEventListener('click', handler);
    this.cleanups.push(() => node.removeEventListener('click', handler));
  }

  /* ------------------------------------------------------------- run flow -- */

  private startBoss() {
    const node = bossNode();
    const boss = pickBoss(this.ctx.state.stats.worldCycle, this.ctx.state.stats.level);
    node.enemy = boss;
    node.title = boss.name;
    node.subtitle = boss.title ?? t('run.boss_blocks');
    this.scene.spawnBoss(node);
    this.ctx.audio.play('boss');
    this.ctx.music.setMode('boss');
    this.el.classList.add('is-boss');
    const warn = this.q('.run-boss-warn');
    warn.classList.add('is-on');
    this.timers.push(window.setTimeout(() => warn.classList.remove('is-on'), 2200));
    this.q('.run-hint').textContent = t('run.no_way_around');
  }

  private onCommit(node: RunEncounter) {
    rememberChoice(node.kind);
    this.q('.run-hint').textContent = t('run.heading', { title: node.title });
    this.el.classList.add('is-committed');
  }

  private resolve(node: RunEncounter) {
    if (this.navigating) return;
    this.navigating = true;
    const ctx = this.ctx;
    ctx.fx.shake(this.el, node.danger >= 2 ? 8 : 4, 260);

    let real = node;
    if (node.kind === 'mystery') {
      real = resolveMystery(ctx.state);
      ctx.toast(real.title, real.enemy ? 'bad' : 'good');
    }

    this.timers.push(
      window.setTimeout(() => {
        ctx.save();
        if (real.kind === 'boss') {
          ctx.goto('combat', { enemy: real.enemy ?? pickBoss(ctx.state.stats.worldCycle, ctx.state.stats.level), node: real });
          return;
        }
        if (real.enemy) {
          ctx.audio.play('swoosh');
          ctx.goto('combat', { enemy: real.enemy, node: real });
          return;
        }
        if (real.kind === 'shop') {
          // The shop has no reward screen to advance the road for us.
          ctx.state.gainProgress();
          ctx.save();
          ctx.goto('shop');
          return;
        }
        ctx.goto('reward', this.rewardFor(real));
      }, ARRIVE_HOLD * 1000)
    );
  }

  private rewardFor(node: RunEncounter): RewardParams {
    const base: RewardParams = {
      title: node.title,
      icon: node.icon,
      message: node.subtitle,
      gold: node.gold,
      xp: node.xp,
      heal: node.heal,
      lootCount: node.lootCount,
      lootRarity: node.lootRarity,
      node,
      grantProgress: true,
      allowDouble: (node.gold ?? 0) > 0 || (node.lootCount ?? 0) > 0
    };
    switch (node.kind) {
      case 'gold':
        return { ...base, icon: '💰', message: t('run.msg_gold') };
      case 'treasure':
        return { ...base, icon: '🧰', message: t('run.msg_treasure') };
      case 'rest':
        return { ...base, icon: '🏕️', message: t('run.msg_rest') };
      case 'shrine':
        return { ...base, icon: '🔮', message: t('run.msg_shrine') };
      default:
        return base;
    }
  }

  /* --------------------------------------------------------------- update -- */

  update(dt: number) {
    this.ctx.fx.update(dt);
    this.scene.update(dt);

    if (this.scene.phase === 'travel' && !this.navigating) {
      this.spawnIn -= dt;
      if (this.spawnIn <= 0) {
        if (this.ctx.state.isBossReady()) this.startBoss();
        else this.scene.spawn(generateChoices(this.ctx.state));
      }
    }

    this.scene.draw();
    this.syncHud(false);
  }

  /* ------------------------------------------------------------------ hud -- */

  private syncHud(force: boolean) {
    const s = this.ctx.state.stats;
    const st = this.ctx.state;

    // Distance ticks every frame; the rest only when it actually changes.
    this.q('.run-dist').textContent = t('common.meters', { n: Math.floor(s.distance) });

    if (force || this.hudDirty || s.gold !== this.lastGold || s.hp !== this.lastHp) {
      this.lastGold = s.gold;
      this.lastHp = s.hp;
      this.hudDirty = false;
      this.q('.run-lvl').textContent = String(s.level);
      (this.q('.run-gold').querySelector('b') as HTMLElement).textContent = String(s.gold);
      (this.q('.run-gems').querySelector('b') as HTMLElement).textContent = String(s.gems);
      const maxHp = st.maxHp;
      fill(this.q('.run-hp'), s.hp / Math.max(1, maxHp));
      this.q('.run-hp-txt').textContent = `${s.hp}/${maxHp}`;
      fill(this.q('.run-xp'), s.xp / Math.max(1, s.xpToNext));

      const left = Math.max(0, s.progressMax - s.progress);
      fill(this.q('.run-boss-bar'), s.progress / Math.max(1, s.progressMax));
      this.q('.run-boss-count').textContent = `${s.progress}/${s.progressMax}`;
      this.q('.run-boss-name').textContent =
        left === 0 ? t('run.boss_ahead') : left === 1 ? t('run.boss_next') : t('run.boss_in', { n: left });
      this.el.classList.toggle('is-boss-near', left <= 1);
    }

    // Choice timer ring: only visible while a choice is open.
    const choosing = this.scene.canChoose;
    if (choosing !== this.wasChoosing) {
      this.wasChoosing = choosing;
      this.el.classList.toggle('is-choosing', choosing);
      if (choosing) this.el.classList.remove('is-committed');
    }
    if (choosing) {
      const frac = this.scene.chooseLeft / Math.max(0.001, this.scene.chooseWindow);
      this.el.style.setProperty('--choose', String(frac));
      this.el.classList.toggle('is-choose-late', frac < 0.3);
    }
  }

  unmount() {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    this.ro?.disconnect();
    this.ro = undefined;
    this.ctx.fx.clear();
    this.el.remove();
    void runMemory();
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

function fill(bar: HTMLElement, frac: number) {
  const f = bar.querySelector('.bar-fill') as HTMLElement | null;
  if (f) f.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
}

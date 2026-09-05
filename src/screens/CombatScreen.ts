import type { CombatParams, GameContext, RewardParams, Screen, ScreenParams } from '../core/context';
import type { CombatAbility } from '../game/data/abilities';
import { STATUS_INFO } from '../game/data/abilities';
import { Combat, type CombatEvent, type PlayerAction, type TurnResult } from '../game/combat';
import { combatConsumables } from '../game/data/consumables';
import type { EnemyInstance, StatusEffect } from '../game/types';
import { CombatArena } from './combat/arena';

/* ============================================================================
 * The fight. A dedicated screen, nothing to do with the road.
 *
 * A round is: you pick an action -> the engine resolves the WHOLE round and
 * hands back a list of events -> this screen plays those events back as timed
 * beats, animating both fighters, so the fight reads as a fight rather than a
 * spreadsheet update. Input is locked while beats play.
 * ========================================================================== */

/** Multiplier on every event's suggested hold, so pacing is tunable in one place. */
const BEAT_SPEED = 1;

interface Beat {
  event: CombatEvent;
  hold: number;
}

export class CombatScreen implements Screen {
  readonly id = 'combat' as const;

  private ctx!: GameContext;
  private el!: HTMLElement;
  private arena!: CombatArena;
  private combat!: Combat;
  private enemy!: EnemyInstance;
  private params!: CombatParams;

  private ro?: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private timers: number[] = [];

  private queue: Beat[] = [];
  private beatTimer = 0;
  private busy = true;
  private finished = false;
  private introLeft = 1.15;
  private totalGold = 0;
  private totalXp = 0;

  private q!: (sel: string) => HTMLElement;

  /* ------------------------------------------------------------- lifecycle -- */

  mount(root: HTMLElement, ctx: GameContext, params: ScreenParams) {
    this.ctx = ctx;
    this.params = params as CombatParams;
    this.enemy = this.params.enemy;
    this.combat = new Combat(ctx.state, this.enemy);

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

    this.buildActions();
    this.syncAll();

    ctx.audio.play(this.enemy.isBoss ? 'boss' : 'swoosh');
    if (this.enemy.isBoss) ctx.fx.shake(el, 10, 500);

    // Intro banner, then hand control over.
    const banner = this.q('.cb-intro');
    banner.classList.add('is-on');
    this.timers.push(
      window.setTimeout(() => {
        banner.classList.remove('is-on');
        this.busy = false;
        this.syncActions();
      }, this.introLeft * 1000)
    );
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
  }

  /* ----------------------------------------------------------------- view -- */

  private template(): string {
    const e = this.enemy;
    const tag = e.isBoss ? 'BOSS' : e.isElite ? 'ELITE' : '';
    return `
      <canvas class="cb-canvas"></canvas>
      <div class="cb-vignette" aria-hidden="true"></div>

      <div class="cb-top">
        <div class="cb-enemy-card">
          <div class="cb-enemy-line">
            ${tag ? `<span class="cb-tag">${tag}</span>` : ''}
            <span class="cb-enemy-name">${esc(e.name)}</span>
            <span class="cb-threat chip"></span>
          </div>
          ${e.title ? `<div class="cb-enemy-title">${esc(e.title)}</div>` : ''}
          <div class="cb-enemy-hp bar bar-hp bar-lg">
            <i class="bar-fill"></i>
            <u class="cb-shield"></u>
            <b class="bar-label cb-enemy-hp-txt"></b>
          </div>
          <div class="cb-phase"></div>
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

      <div class="cb-log"><span></span></div>

      <div class="cb-bottom">
        <div class="cb-hero-card">
          <div class="cb-hero-line">
            <span class="cb-hero-name">You</span>
            <span class="cb-status cb-status-hero"></span>
          </div>
          <div class="cb-hero-hp bar bar-hp"><i class="bar-fill"></i><b class="bar-label cb-hero-hp-txt"></b></div>
          <div class="cb-energy-row">
            <span class="cb-energy-label">EN</span>
            <div class="cb-energy bar bar-energy bar-sm"><i class="bar-fill"></i></div>
            <b class="cb-energy-txt">0</b>
          </div>
        </div>
        <div class="cb-actions"></div>
        <div class="cb-minor">
          <button class="btn btn-ghost btn-sm cb-brace">🛡 Brace</button>
          <button class="btn btn-ghost btn-sm cb-item">🧪 Item</button>
          <button class="btn btn-ghost btn-sm cb-flee">🏃 Flee</button>
        </div>
      </div>

      <div class="cb-intro"><span class="cb-intro-name">${esc(this.enemy.name)}</span><span class="cb-intro-sub">${esc(this.enemy.title ?? (this.enemy.isBoss ? 'blocks the road' : 'blocks your path'))}</span></div>
      <div class="cb-end"></div>
    `;
  }

  private buildActions() {
    const host = this.q('.cb-actions');
    host.innerHTML = '';

    const basic = document.createElement('button');
    basic.className = 'btn btn-primary cb-act cb-act-basic';
    basic.innerHTML = `<i>⚔</i><b>Strike</b><u>+${3} EN</u>`;
    basic.addEventListener('click', () => this.take({ type: 'basic' }));
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
      <b>${esc(ability.name)}</b>
      <u class="cb-cost">${ability.cost} EN</u>
      <s class="cb-cd"></s>`;
    b.addEventListener('click', () => {
      const { ok, reason } = this.combat.canUse(ability);
      if (!ok) {
        this.ctx.toast(reason === 'Energy' ? 'Not enough energy' : `Ready in ${reason}`, 'bad');
        this.ctx.audio.play('ui_back');
        return;
      }
      this.take({ type: 'ability', id: ability.id });
    });
    b.addEventListener('contextmenu', e => {
      e.preventDefault();
      this.ctx.toast(`${ability.name} — ${ability.description}`);
    });
    return b;
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

  /* ----------------------------------------------------------------- turn -- */

  private take(action: PlayerAction) {
    if (this.busy || this.finished) return;
    this.busy = true;
    this.syncActions();
    const result = this.combat.act(action);
    this.enqueue(result);
  }

  private enqueue(result: TurnResult) {
    this.queue = result.events.map(event => ({ event, hold: (event.hold ?? 0.34) * BEAT_SPEED }));
    this.beatTimer = 0;
    this.pendingOutcome = result.status;
    // Play the first beat immediately so the tap feels connected.
    this.nextBeat();
  }

  private pendingOutcome: TurnResult['status'] = 'ongoing';

  private nextBeat() {
    const beat = this.queue.shift();
    if (!beat) {
      this.onBeatsDone();
      return;
    }
    this.beatTimer = beat.hold;
    this.playBeat(beat.event);
    this.syncAll();
  }

  private playBeat(ev: CombatEvent) {
    const ctx = this.ctx;
    const onEnemy = ev.target === 'enemy';
    const label = ev.label ?? (ev.amount != null ? String(Math.round(ev.amount)) : '');

    const line = this.logLine(ev);
    if (line) {
      const log = this.q('.cb-log');
      log.firstElementChild!.textContent = line;
      log.classList.remove('is-new');
      void log.offsetWidth;
      log.classList.add('is-new');
    }

    switch (ev.kind) {
      case 'action':
        this.arena.pose(ev.source ?? 'player', ev.source === 'enemy' ? 'attack' : 'attack');
        ctx.audio.play('swoosh');
        break;
      case 'damage':
      case 'crit': {
        const crit = ev.kind === 'crit';
        this.arena.hit(ev.target);
        this.arena.pose(ev.target, 'hurt');
        this.arena.burst(ev.target, crit ? 'crit' : 'hit');
        this.floatOn(ev.target, label || '—', crit ? 'crit' : 'damage');
        ctx.audio.play(crit ? 'crit' : 'hit');
        ctx.fx.shake(this.el, crit ? 9 : 4, crit ? 300 : 200);
        if (!onEnemy) ctx.fx.flash('rgba(255,60,90,0.22)', 180);
        break;
      }
      case 'block':
        this.floatOn(ev.target, label || 'Block', 'block');
        this.arena.pose(ev.target, ev.target === 'player' ? 'defend' : 'idle');
        ctx.audio.play('block');
        break;
      case 'heal':
        this.arena.burst(ev.target, 'heal');
        this.floatOn(ev.target, `+${label}`, 'heal');
        ctx.audio.play('heal');
        break;
      case 'shield':
        this.floatOn(ev.target, `⛊ ${label}`, 'block');
        ctx.audio.play('block');
        break;
      case 'status':
        this.floatOn(ev.target, `${ev.icon ?? '✦'} ${ev.label ?? ''}`.trim(), 'status');
        ctx.audio.play('magic');
        break;
      case 'dot':
        this.arena.hit(ev.target);
        this.floatOn(ev.target, label, ev.amount && ev.amount > 0 ? 'damage' : 'heal');
        break;
      case 'phase':
        this.el.classList.add('is-phase');
        this.timers.push(window.setTimeout(() => this.el.classList.remove('is-phase'), 900));
        ctx.fx.shake(this.el, 12, 600);
        ctx.audio.play('boss');
        ctx.fx.flash('rgba(255,140,60,0.28)', 320);
        break;
      case 'revive':
        this.arena.burst(ev.target, 'levelup');
        ctx.audio.play('levelup');
        break;
      case 'death':
        this.arena.pose(ev.target, 'dead');
        this.arena.burst(ev.target, 'death');
        ctx.audio.play(ev.target === 'enemy' ? 'victory' : 'defeat');
        break;
      case 'flee':
        ctx.audio.play('ui_back');
        break;
      default:
        break;
    }
  }

  /**
   * The engine's `text` is tuned for floating numbers ("19"), so the narration
   * line is composed here instead — the log is prose, the floats are numbers.
   */
  private logLine(ev: CombatEvent): string {
    const who = (side: 'player' | 'enemy') => (side === 'player' ? 'You' : this.enemy.name);
    switch (ev.kind) {
      case 'action':
        return ev.source === 'enemy' ? `${this.enemy.name} — ${ev.text}` : `You use ${ev.text}.`;
      case 'damage':
        return `${who(ev.target)} ${ev.target === 'player' ? 'take' : 'takes'} ${ev.text} damage.`;
      case 'crit':
        return `Critical! ${who(ev.target)} ${ev.target === 'player' ? 'take' : 'takes'} ${ev.text}.`;
      case 'block':
        return `${who(ev.target)} ${ev.target === 'player' ? 'absorb' : 'absorbs'} the blow.`;
      case 'heal':
        return `${who(ev.target)} ${ev.target === 'player' ? 'recover' : 'recovers'} ${ev.text} HP.`;
      case 'shield':
        return `${who(ev.target)} ${ev.target === 'player' ? 'gain' : 'gains'} a ${ev.text} shield.`;
      case 'dot':
        return `${ev.icon ?? '✦'} ${who(ev.target)} — ${ev.text}`;
      default:
        return ev.text;
    }
  }

  private floatOn(side: 'player' | 'enemy', text: string, kind: Parameters<GameContext['fx']['float']>[4]) {
    const p = this.arena.anchor(side);
    this.ctx.fx.float(this.el, p.x, p.y, text, kind);
  }

  private onBeatsDone() {
    const status = this.pendingOutcome;
    if (status === 'ongoing') {
      this.busy = false;
      this.arena.pose('player', 'idle');
      this.arena.pose('enemy', 'idle');
      this.syncAll();
      return;
    }
    if (this.finished) return;
    this.finished = true;
    if (status === 'won') this.win();
    else if (status === 'lost') this.lose();
    else this.flee();
  }

  /* -------------------------------------------------------------- endings -- */

  private win() {
    const ctx = this.ctx;
    const e = this.enemy;
    ctx.state.stats.battlesWon += 1;
    this.arena.pose('player', 'victory');
    this.totalGold = e.goldReward;
    this.totalXp = e.xpReward;

    const params: RewardParams = {
      title: e.isBoss ? `${e.name} Defeated` : 'Victory',
      icon: e.isBoss ? '👑' : '⚔️',
      message: e.isBoss ? 'The road ahead is open.' : `${e.name} is down after ${this.combat.turns} rounds.`,
      gold: this.totalGold,
      xp: this.totalXp,
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
        gold: this.totalGold,
        xp: this.totalXp,
        turns: this.combat.turns,
        loot: []
      }
    };
    this.endBanner('VICTORY', 'is-win');
    this.after(1.0, () => ctx.goto('reward', params));
  }

  private lose() {
    const ctx = this.ctx;
    this.endBanner('DEFEATED', 'is-lose');
    const host = this.q('.cb-end');
    const lost = Math.round(ctx.state.stats.gold * 0.25);

    const panel = document.createElement('div');
    panel.className = 'cb-end-panel panel';
    panel.innerHTML = `
      <div class="panel-bd">
        <p class="cb-end-line">You wake at the roadside. The ${esc(this.enemy.name)} is gone — and so is some of your purse.</p>
        <p class="cb-end-cost">−${lost} 🪙</p>
      </div>`;

    const revive = document.createElement('button');
    revive.className = 'btn btn-gold btn-block cb-revive';
    revive.innerHTML = `<i>📺</i> Second Wind <u>Watch an ad</u>`;
    revive.addEventListener('click', () => {
      ctx.audio.play('levelup');
      ctx.toast('Ad reward — placeholder', 'info');
      ctx.state.stats.hp = Math.max(1, Math.round(ctx.state.maxHp * 0.6));
      this.enemy.hp = Math.max(1, Math.round(this.enemy.hp * 0.5));
      ctx.save();
      this.resume();
    });

    const give = document.createElement('button');
    give.className = 'btn btn-ghost btn-block';
    give.textContent = 'Limp back to the road';
    give.addEventListener('click', () => {
      ctx.audio.play('ui_back');
      ctx.state.stats.gold = Math.max(0, ctx.state.stats.gold - lost);
      ctx.state.stats.hp = Math.max(1, Math.round(ctx.state.maxHp * 0.4));
      ctx.save();
      ctx.goto('run');
    });

    panel.appendChild(revive);
    panel.appendChild(give);
    host.appendChild(panel);
    this.after(0.35, () => panel.classList.add('is-on'));
  }

  private flee() {
    const ctx = this.ctx;
    this.endBanner('ESCAPED', 'is-flee');
    ctx.toast('You slip away — no reward.', 'info');
    ctx.save();
    this.after(0.9, () => ctx.goto('run'));
  }

  /** Continues the fight after a revive. */
  private resume() {
    this.finished = false;
    this.busy = false;
    this.combat.status = 'ongoing';
    this.pendingOutcome = 'ongoing';
    this.el.classList.remove('is-over', 'is-win', 'is-lose', 'is-flee');
    this.q('.cb-end').innerHTML = '';
    this.arena.pose('player', 'idle');
    this.arena.pose('enemy', 'idle');
    this.syncAll();
  }

  private endBanner(text: string, cls: string) {
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

  /* ---------------------------------------------------------------- items -- */

  private openItems() {
    const state = this.ctx.state;
    const owned = combatConsumables().filter(c => state.consumableCount(c.id) > 0);
    const scrim = document.createElement('div');
    scrim.className = 'sheet-scrim is-on';
    const sheet = document.createElement('div');
    sheet.className = 'sheet cb-item-sheet';
    sheet.innerHTML = `
      <div class="sheet-hd"><b>Satchel</b><button class="icon-btn cb-sheet-close" aria-label="Close">✕</button></div>
      <div class="sheet-bd"></div>`;
    const body = sheet.querySelector('.sheet-bd') as HTMLElement;

    if (!owned.length) {
      body.innerHTML = `<p class="cb-empty">Nothing usable in a fight. Buy potions at the next trader.</p>`;
    }
    for (const c of owned) {
      const b = document.createElement('button');
      b.className = 'btn btn-ghost btn-block cb-item-row';
      b.innerHTML = `<i>${c.icon}</i><span><b>${esc(c.name)}</b><u>${esc(c.description)}</u></span><em>×${state.consumableCount(c.id)}</em>`;
      b.addEventListener('click', () => {
        close();
        this.busy = false; // bind() gate already passed; take() re-locks
        this.take({ type: 'item', id: c.id });
      });
      body.appendChild(b);
    }

    const close = () => {
      scrim.remove();
      sheet.remove();
      this.busy = false;
      this.syncActions();
    };
    scrim.addEventListener('click', close);
    (sheet.querySelector('.cb-sheet-close') as HTMLElement).addEventListener('click', close);
    this.el.appendChild(scrim);
    this.el.appendChild(sheet);
    requestAnimationFrame(() => sheet.classList.add('is-on'));
    this.busy = true;
    this.syncActions();
    this.cleanups.push(() => {
      scrim.remove();
      sheet.remove();
    });
  }

  /* ----------------------------------------------------------------- sync -- */

  private syncAll() {
    const c = this.combat;
    const st = this.ctx.state;

    // Enemy
    fill(this.q('.cb-enemy-hp'), c.enemyHp / Math.max(1, this.enemy.maxHp));
    this.q('.cb-enemy-hp-txt').textContent = `${Math.max(0, c.enemyHp)} / ${this.enemy.maxHp}`;
    const shieldEl = this.q('.cb-shield');
    shieldEl.style.width = `${Math.min(100, (c.enemyShield / Math.max(1, this.enemy.maxHp)) * 100)}%`;
    shieldEl.classList.toggle('is-on', c.enemyShield > 0);

    const threat = c.threat();
    const chip = this.q('.cb-threat');
    chip.textContent = threat.label;
    chip.className = `cb-threat chip threat-${threat.level}`;

    this.q('.cb-phase').textContent = c.phaseName ? `— ${c.phaseName} —` : '';

    // Intent
    const intent = c.intent;
    this.q('.cb-intent-icon').textContent = intent.icon;
    this.q('.cb-intent-label').textContent = intent.label;
    const dmg = c.intentDamage();
    this.q('.cb-intent-sub').textContent = dmg > 0 ? `about ${dmg} damage` : (c.passiveInfo?.name ?? '');
    this.el.classList.toggle('is-threatened', dmg > 0 && dmg >= st.stats.hp);

    // Player
    const maxHp = st.maxHp;
    fill(this.q('.cb-hero-hp'), st.stats.hp / Math.max(1, maxHp));
    this.q('.cb-hero-hp-txt').textContent = `${Math.max(0, st.stats.hp)} / ${maxHp}`;
    fill(this.q('.cb-energy'), c.energy / 10);
    this.q('.cb-energy-txt').textContent = String(c.energy);

    this.renderStatuses(this.q('.cb-status-enemy'), c.enemyStatuses);
    this.renderStatuses(this.q('.cb-status-hero'), c.playerStatuses);

    this.syncActions();
  }

  private renderStatuses(host: HTMLElement, list: StatusEffect[]) {
    host.innerHTML = '';
    for (const s of list) {
      const info = STATUS_INFO[s.id];
      if (!info) continue;
      const chip = document.createElement('span');
      chip.className = `cb-st ${info.harmful ? 'is-bad' : 'is-good'}`;
      chip.style.setProperty('--st', info.color);
      chip.innerHTML = `<i>${info.icon}</i><b>${s.stacks}</b><u>${s.turns}</u>`;
      chip.title = `${info.name} — ${info.description}`;
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
      const poor = c.energy < ability.cost;
      btn.classList.toggle('is-cooling', cd > 0);
      btn.classList.toggle('is-poor', poor && cd <= 0);
      (btn.querySelector('.cb-cd') as HTMLElement).textContent = cd > 0 ? String(cd) : '';
      if (!locked) btn.disabled = cd > 0 || poor;
    }
  }

  /* --------------------------------------------------------------- update -- */

  update(dt: number) {
    this.ctx.fx.update(dt);
    this.arena.update(dt);
    this.arena.draw();

    if (this.beatTimer > 0) {
      this.beatTimer -= dt;
      if (this.beatTimer <= 0) this.nextBeat();
    }
  }
}

/* ------------------------------------------------------------------ utils -- */

function fill(bar: HTMLElement, frac: number) {
  const f = bar.querySelector('.bar-fill') as HTMLElement | null;
  if (f) f.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

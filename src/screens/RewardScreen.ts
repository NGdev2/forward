import type { GameContext, RewardParams, Screen, ScreenParams } from '../core/context';
import type { ItemInstance } from '../game/types';
import { rollLoot } from '../game/loot';
import { itemDetail, itemTile, rarityVar } from './inventory/ui';
import { rarityById } from '../game/config';

/* ============================================================================
 * The payoff screen.
 *
 * ARCHITECTURAL RULE: this is the ONE place rewards are applied to state.
 * Every other screen only *describes* what was earned via RewardParams; the
 * gold, xp, healing, loot and boss-bar progress all land here, exactly once.
 * ========================================================================== */

interface Applied {
  gold: number;
  xp: number;
  healed: number;
  levels: number;
  loot: ItemInstance[];
}

export class RewardScreen implements Screen {
  readonly id = 'reward' as const;

  private ctx!: GameContext;
  private el!: HTMLElement;
  private params!: RewardParams;
  private applied!: Applied;
  private cleanups: (() => void)[] = [];
  private timers: number[] = [];
  private doubled = false;
  private revealIn = 0.28;
  private revealQueue: HTMLElement[] = [];

  mount(root: HTMLElement, ctx: GameContext, params: ScreenParams) {
    this.ctx = ctx;
    this.params = params as RewardParams;

    this.applied = this.apply(this.params);
    ctx.save();

    const el = document.createElement('div');
    el.className = 'screen screen-reward';
    if (this.params.bossDefeated) el.classList.add('is-boss');
    if (this.best()) el.classList.add(`is-${this.best()}`);
    el.innerHTML = this.template();
    root.appendChild(el);
    this.el = el;

    this.renderLoot();
    this.wire();

    ctx.audio.play(this.params.bossDefeated ? 'victory' : 'loot');
    if (this.applied.levels > 0) {
      this.timers.push(
        window.setTimeout(() => {
          ctx.audio.play('levelup');
          ctx.toast(`Level ${ctx.state.stats.level}!`, 'good');
          ctx.fx.burst(window.innerWidth / 2, window.innerHeight * 0.35, 'levelup');
        }, 700)
      );
    }
  }

  unmount() {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    this.ctx.fx.clear();
    this.el.remove();
  }

  /* ----------------------------------------------------------- applying -- */

  /** The only mutation point. Returns what actually landed, for display. */
  private apply(p: RewardParams): Applied {
    const state = this.ctx.state;
    const before = state.stats.hp;

    const gold = p.gold ? state.addGold(p.gold) : 0;
    const levelling = p.xp ? state.addXp(p.xp) : { leveledUp: false, levels: 0 };
    if (p.heal) state.heal(p.heal);
    const healed = Math.max(0, state.stats.hp - before);

    let loot = p.loot ?? [];
    if (!loot.length && p.lootCount) {
      loot = rollLoot(p.lootCount, state.stats.level, state.luck, p.lootRarity);
    }
    // Anything that will not fit is auto-sold rather than silently lost.
    const kept: ItemInstance[] = [];
    for (const item of loot) {
      if (state.addItem(item)) kept.push(item);
      else {
        state.stats.gold += state.sellValue(item);
        this.ctx.toast(`Bag full — ${item.name} sold`, 'info');
      }
    }

    if (p.bossDefeated) state.onBossDefeated();
    else if (p.grantProgress !== false) state.gainProgress();

    return { gold, xp: p.xp ?? 0, healed, levels: levelling.levels, loot: kept };
  }

  /** Rarity of the best item dropped, for the screen's colour treatment. */
  private best(): string | null {
    let bestIdx = -1;
    let bestId: string | null = null;
    for (const item of this.applied.loot) {
      const idx = rarityById(item.rarity).affixCount;
      if (idx > bestIdx) {
        bestIdx = idx;
        bestId = item.rarity;
      }
    }
    return bestId;
  }

  /* --------------------------------------------------------------- view -- */

  private template(): string {
    const p = this.params;
    const a = this.applied;
    const rows: string[] = [];
    if (a.gold) rows.push(row('🪙', 'Gold', `+${a.gold}`, 'gold'));
    if (a.xp) rows.push(row('✦', 'Experience', `+${a.xp}`, 'xp'));
    if (a.healed) rows.push(row('❤️', 'Recovered', `+${a.healed}`, 'good'));
    if (a.levels) rows.push(row('⬆️', a.levels > 1 ? `${a.levels} levels` : 'Level up', `→ ${this.ctx.state.stats.level}`, 'accent'));

    return `
      <div class="rw-glow" aria-hidden="true"></div>
      <div class="rw-body">
        <div class="rw-head">
          <span class="rw-icon">${p.icon}</span>
          <h1 class="rw-title">${esc(p.title)}</h1>
          ${p.message ? `<p class="rw-msg">${esc(p.message)}</p>` : ''}
        </div>

        ${rows.length ? `<div class="rw-rows panel panel-flat">${rows.join('')}</div>` : ''}

        <div class="rw-loot"></div>
      </div>

      <div class="rw-foot">
        ${p.allowDouble ? `<button class="btn btn-gold btn-block rw-double"><i>📺</i><span>Double it<u>Watch a short ad</u></span></button>` : ''}
        <div class="rw-foot-row">
          <button class="btn btn-ghost rw-bag">🎒 Bag</button>
          <button class="btn btn-primary btn-cta rw-go">Keep going →</button>
        </div>
      </div>
    `;
  }

  private renderLoot() {
    const host = this.el.querySelector('.rw-loot') as HTMLElement;
    host.innerHTML = '';
    if (!this.applied.loot.length) return;

    const head = document.createElement('div');
    head.className = 'rw-loot-head';
    head.textContent = this.applied.loot.length > 1 ? 'Spoils' : 'You found';
    host.appendChild(head);

    for (const item of this.applied.loot) {
      const card = document.createElement('div');
      card.className = 'rw-drop';
      card.style.setProperty('--rc', rarityVar(item.rarity));

      const tile = itemTile(item, { upgrade: this.ctx.state.isUpgrade(item) });
      tile.classList.add('rw-drop-tile');
      const detail = itemDetail(item, this.ctx.state.equipment[item.slot]);
      card.appendChild(tile);
      card.appendChild(detail);

      // Equipping straight from the drop is the whole point of a loot screen.
      const equip = document.createElement('button');
      equip.className = 'btn btn-sm rw-equip';
      const refresh = () => {
        const worn = this.ctx.state.equipment[item.slot]?.uid === item.uid;
        equip.textContent = worn ? '✓ Equipped' : this.ctx.state.isUpgrade(item) ? '▲ Equip (upgrade)' : 'Equip';
        equip.disabled = worn;
        equip.classList.toggle('btn-primary', !worn && this.ctx.state.isUpgrade(item));
        equip.classList.toggle('btn-ghost', worn || !this.ctx.state.isUpgrade(item));
      };
      equip.addEventListener('click', () => {
        const res = this.ctx.state.equip(item);
        if (res.blocked) {
          this.ctx.toast('Bag is full — nowhere to put the old one', 'bad');
          return;
        }
        this.ctx.audio.play('loot');
        this.ctx.toast(`Equipped ${item.name}`, 'good');
        this.ctx.save();
        refresh();
      });
      refresh();
      card.appendChild(equip);

      host.appendChild(card);
      this.revealQueue.push(card);
    }

    const rare = this.applied.loot.some(i => ['legendary', 'mythic'].includes(i.rarity));
    if (rare) {
      this.timers.push(
        window.setTimeout(() => {
          this.ctx.audio.play('legendary');
          this.ctx.fx.burst(window.innerWidth / 2, window.innerHeight * 0.5, 'magic', { count: 40 });
        }, 500)
      );
    }
  }

  private wire() {
    this.bind('.rw-go', () => this.ctx.goto('run'));
    this.bind('.rw-bag', () => this.ctx.goto('inventory'));
    this.bind('.rw-double', () => this.double());
  }

  private bind(sel: string, fn: () => void) {
    const node = this.el.querySelector(sel) as HTMLElement | null;
    if (!node) return;
    const handler = () => {
      this.ctx.audio.play('ui_tap');
      fn();
    };
    node.addEventListener('click', handler);
    this.cleanups.push(() => node.removeEventListener('click', handler));
  }

  /**
   * Rewarded-ad double-up. The ad SDK is deliberately not wired yet — this is
   * the placeholder surface the real integration will drop into.
   */
  private double() {
    if (this.doubled) return;
    this.doubled = true;
    const btn = this.el.querySelector('.rw-double') as HTMLElement;
    btn.classList.add('is-spent');
    (btn as HTMLButtonElement).disabled = true;

    const extraGold = this.applied.gold;
    const extraXp = this.applied.xp;
    if (extraGold) this.ctx.state.stats.gold += extraGold;
    if (extraXp) this.applied.levels += this.ctx.state.addXp(extraXp).levels;
    this.applied.gold += extraGold;
    this.applied.xp += extraXp;
    this.ctx.save();

    this.ctx.audio.play('coin');
    this.ctx.toast('Doubled! (ad placeholder)', 'legendary');
    this.ctx.fx.burst(window.innerWidth / 2, window.innerHeight * 0.42, 'coin', { count: 30 });

    // Re-render the ledger rows in place.
    const rows = this.el.querySelector('.rw-rows');
    if (rows) {
      const a = this.applied;
      const out: string[] = [];
      if (a.gold) out.push(row('🪙', 'Gold', `+${a.gold}`, 'gold'));
      if (a.xp) out.push(row('✦', 'Experience', `+${a.xp}`, 'xp'));
      if (a.healed) out.push(row('❤️', 'Recovered', `+${a.healed}`, 'good'));
      if (a.levels) out.push(row('⬆️', a.levels > 1 ? `${a.levels} levels` : 'Level up', `→ ${this.ctx.state.stats.level}`, 'accent'));
      rows.innerHTML = out.join('');
      rows.classList.add('is-bumped');
    }
  }

  /* ------------------------------------------------------------- update -- */

  update(dt: number) {
    this.ctx.fx.update(dt);
    if (!this.revealQueue.length) return;
    this.revealIn -= dt;
    if (this.revealIn <= 0) {
      this.revealIn = 0.22;
      const next = this.revealQueue.shift();
      next?.classList.add('is-in');
      if (next) this.ctx.audio.play('loot');
    }
  }
}

/* ------------------------------------------------------------------ utils -- */

function row(icon: string, label: string, value: string, tone: string): string {
  return `<div class="rw-row rw-row-${tone}"><i>${icon}</i><span>${label}</span><b>${value}</b></div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

import type { GameContext, RewardParams, Screen, ScreenParams } from '../core/context';
import type { ItemInstance } from '../game/types';
import { rollLoot } from '../game/loot';
import { elementBadge, itemDetail, itemTile, rarityVar } from './inventory/ui';
import { rarityById } from '../game/config';
import { setById, setPieces, wornSetCounts } from '../game/data/items';
import { biomeFor } from './run/biomes';
import { itemDisplayName, name as cname, t } from '../i18n';

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
    // Singleton screen: reset per-visit fields before anything reads them.
    this.doubled = false;
    this.revealIn = 0.28;
    this.revealQueue = [];

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
          ctx.toast(t('common.level_toast', { n: ctx.state.stats.level }), 'good');
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
        this.ctx.toast(t('reward.bag_full_sold', { name: itemDisplayName(item) }), 'info');
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
    const rows = this.ledgerRows(a);

    // After a boss the world cycle has already advanced (apply() ran first),
    // so biomeFor() now names the country the road is about to enter.
    const next = p.bossDefeated ? biomeFor(this.ctx.state.stats.worldCycle) : null;

    return `
      <div class="rw-glow" aria-hidden="true"></div>
      <div class="rw-body">
        <div class="rw-head">
          <span class="rw-icon">${p.icon}</span>
          <h1 class="rw-title">${esc(p.title)}</h1>
          ${p.message ? `<p class="rw-msg">${esc(p.message)}</p>` : ''}
          ${next ? `<p class="rw-next"><i>🧭</i>${esc(t('reward.road_turns'))} <b>${esc(cname('biome', next.id, next.name))}</b></p>` : ''}
        </div>

        ${rows.length ? `<div class="rw-rows panel panel-flat">${rows.join('')}</div>` : ''}

        <div class="rw-loot"></div>
      </div>

      <div class="rw-foot">
        ${p.allowDouble ? `<button class="btn btn-gold btn-block rw-double"><i>📺</i><span>${esc(t('reward.double'))}<u>${esc(t('reward.watch_ad'))}</u></span></button>` : ''}
        <div class="rw-foot-row">
          <button class="btn btn-ghost rw-bag">🎒 ${esc(t('common.bag'))}</button>
          <button class="btn btn-primary btn-cta rw-go">${esc(t('reward.keep_going'))}</button>
        </div>
      </div>
    `;
  }

  /** The gold / xp / heal / level rows, in display order. */
  private ledgerRows(a: Applied): string[] {
    const rows: string[] = [];
    if (a.gold) rows.push(row('🪙', t('common.gold'), `+${a.gold}`, 'gold'));
    if (a.xp) rows.push(row('✦', t('reward.xp'), `+${a.xp}`, 'xp'));
    if (a.healed) rows.push(row('❤️', t('reward.recovered'), `+${a.healed}`, 'good'));
    if (a.levels) rows.push(row('⬆️', a.levels > 1 ? t('reward.levels', { n: a.levels }) : t('common.level_up'), `→ ${this.ctx.state.stats.level}`, 'accent'));
    return rows;
  }

  private renderLoot() {
    const host = this.el.querySelector('.rw-loot') as HTMLElement;
    host.innerHTML = '';
    if (!this.applied.loot.length) return;

    const head = document.createElement('div');
    head.className = 'rw-loot-head';
    head.textContent = this.applied.loot.length > 1 ? t('reward.spoils') : t('reward.found');
    host.appendChild(head);

    for (const item of this.applied.loot) {
      const card = document.createElement('div');
      card.className = 'rw-drop';
      card.style.setProperty('--rc', rarityVar(item.rarity));

      const tile = itemTile(item, { upgrade: this.ctx.state.isUpgrade(item) });
      tile.classList.add('rw-drop-tile');
      let detail = itemDetail(item, this.ctx.state.equipment[item.slot], this.ctx.state.equipment);
      card.appendChild(tile);
      card.appendChild(detail);

      // Set pieces get a banner above the sheet: the set, its element and how
      // close the player is to the next bonus. Kept live by the equip button.
      const set = setById(item.setId);
      const banner = set ? document.createElement('div') : null;
      const refreshBanner = () => {
        if (!set || !banner) return;
        const worn = wornSetCounts(this.ctx.state.equipment).get(set.id) ?? 0;
        banner.className = 'rw-set';
        banner.style.setProperty('--el', `var(--el-${set.element})`);
        banner.style.setProperty('--el-soft', `var(--el-${set.element}-soft)`);
        banner.innerHTML = `<b>${set.icon} ${esc(t('reward.set_piece', { set: cname('set', set.id, set.name) }))}</b><em>${esc(t('reward.worn', { n: worn, total: setPieces(set.id).length }))}</em>`;
        banner.insertBefore(elementBadge(set.element), banner.querySelector('em'));
      };
      if (banner) {
        refreshBanner();
        card.appendChild(banner);
      }

      // Equipping straight from the drop is the whole point of a loot screen.
      const equip = document.createElement('button');
      equip.className = 'btn btn-sm rw-equip';
      const refresh = () => {
        const worn = this.ctx.state.equipment[item.slot]?.uid === item.uid;
        equip.textContent = worn ? t('reward.equipped') : this.ctx.state.isUpgrade(item) ? t('reward.equip_upgrade') : t('common.equip');
        equip.disabled = worn;
        equip.classList.toggle('btn-primary', !worn && this.ctx.state.isUpgrade(item));
        equip.classList.toggle('btn-ghost', worn || !this.ctx.state.isUpgrade(item));
      };
      equip.addEventListener('click', () => {
        const res = this.ctx.state.equip(item);
        if (res.blocked) {
          this.ctx.toast(t('reward.bag_full_old'), 'bad');
          return;
        }
        this.ctx.audio.play('loot');
        this.ctx.toast(t('reward.equipped_toast', { name: itemDisplayName(item) }), 'good');
        this.ctx.save();
        refresh();
        refreshBanner();
        // The sheet's own set block ("N/4 worn", unlocked bonuses) and its
        // comparison are now stale; rebuild it in place.
        const fresh = itemDetail(item, this.ctx.state.equipment[item.slot], this.ctx.state.equipment);
        detail.replaceWith(fresh);
        detail = fresh;
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
    // "Back" from the bag must land on the road, never here: remounting the
    // reward screen would apply the reward again.
    this.bind('.rw-bag', () => this.ctx.goto('inventory', { from: 'run' }));
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
    this.ctx.toast(t('reward.doubled'), 'legendary');
    this.ctx.fx.burst(window.innerWidth / 2, window.innerHeight * 0.42, 'coin', { count: 30 });

    // Re-render the ledger rows in place.
    const rows = this.el.querySelector('.rw-rows');
    if (rows) {
      rows.innerHTML = this.ledgerRows(this.applied).join('');
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
  return `<div class="rw-row rw-row-${tone}"><i>${icon}</i><span>${esc(label)}</span><b>${value}</b></div>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

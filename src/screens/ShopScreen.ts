import type { GameContext, Screen, ScreenParams } from '../core/context';
import type { ItemInstance } from '../game/types';
import { rollShopStock } from '../game/loot';
import { CONSUMABLES, type ConsumableDef } from '../game/data/consumables';
import { SLOT_LABEL, clear, itemDetail, itemTile, openSheet, rarityVar } from './inventory/ui';
import { rarityById } from '../game/config';

/* ============================================================================
 * The wayside trader. Three tabs: gear, supplies, and the (placeholder) gem
 * store that the real IAP integration will slot into.
 *
 * Stock is rolled once per visit and cached on the module so backing out to
 * the bag and returning doesn't reroll the wares.
 * ========================================================================== */

interface Stall {
  stock: ItemInstance[];
  bought: Set<string>;
  level: number;
}

let stall: Stall | null = null;

/** Called when the player leaves the shop node, so the next trader is new. */
export function closeStall() {
  stall = null;
}

type Tab = 'gear' | 'supplies' | 'gems';

/** Placeholder gem bundles. No billing SDK is wired up yet, by design. */
const GEM_PACKS = [
  { id: 'gems_s', gems: 100, price: '$0.99', tag: '', icon: '💎' },
  { id: 'gems_m', gems: 550, price: '$4.99', tag: '+10%', icon: '💠' },
  { id: 'gems_l', gems: 1200, price: '$9.99', tag: 'Best value', icon: '🔷' }
];

export class ShopScreen implements Screen {
  readonly id = 'shop' as const;

  private ctx!: GameContext;
  private el!: HTMLElement;
  private tab: Tab = 'gear';
  private cleanups: (() => void)[] = [];
  private closeSheet: (() => void) | null = null;

  mount(root: HTMLElement, ctx: GameContext, _params: ScreenParams) {
    this.ctx = ctx;
    this.tab = 'gear';
    this.closeSheet = null;
    const level = ctx.state.stats.level;
    if (!stall || stall.level !== level) {
      stall = { stock: rollShopStock(level, 6), bought: new Set(), level };
    }

    const el = document.createElement('div');
    el.className = 'screen screen-shop';
    el.innerHTML = `
      <div class="shop-top topbar">
        <button class="icon-btn btn btn-ghost shop-back" aria-label="Back">←</button>
        <div class="topbar-title">Wayside Trader</div>
        <div class="shop-purse">
          <span class="chip chip-gold"><i>🪙</i><b class="shop-gold">0</b></span>
          <span class="chip chip-gem"><i>💎</i><b class="shop-gems">0</b></span>
        </div>
      </div>
      <div class="shop-greet">
        <span class="shop-keeper">🧙</span>
        <p class="shop-line">"Road's long. Buy something that keeps you on it."</p>
      </div>
      <div class="shop-tabs seg">
        <button class="seg-btn is-on" data-tab="gear">Gear</button>
        <button class="seg-btn" data-tab="supplies">Supplies</button>
        <button class="seg-btn" data-tab="gems">Gems</button>
      </div>
      <div class="shop-body"></div>
      <div class="shop-foot">
        <button class="btn btn-primary btn-block btn-cta shop-leave">Back to the road →</button>
      </div>
    `;
    root.appendChild(el);
    this.el = el;

    for (const btn of Array.from(el.querySelectorAll<HTMLElement>('.seg-btn'))) {
      const handler = () => {
        ctx.audio.play('ui_tap');
        this.tab = btn.dataset.tab as Tab;
        for (const b of Array.from(el.querySelectorAll('.seg-btn'))) b.classList.toggle('is-on', b === btn);
        this.render();
      };
      btn.addEventListener('click', handler);
      this.cleanups.push(() => btn.removeEventListener('click', handler));
    }

    this.bind('.shop-back', () => this.leave());
    this.bind('.shop-leave', () => this.leave());

    this.render();
    this.syncPurse();
  }

  unmount() {
    this.closeSheet?.();
    this.closeSheet = null;
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.el.remove();
  }

  private leave() {
    closeStall();
    this.ctx.save();
    this.ctx.goto('run');
  }

  private bind(sel: string, fn: () => void) {
    const node = this.el.querySelector(sel) as HTMLElement | null;
    if (!node) return;
    const handler = () => {
      this.ctx.audio.play('ui_back');
      fn();
    };
    node.addEventListener('click', handler);
    this.cleanups.push(() => node.removeEventListener('click', handler));
  }

  private syncPurse() {
    (this.el.querySelector('.shop-gold') as HTMLElement).textContent = String(this.ctx.state.stats.gold);
    (this.el.querySelector('.shop-gems') as HTMLElement).textContent = String(this.ctx.state.stats.gems);
  }

  /* --------------------------------------------------------------- tabs -- */

  private render() {
    const host = this.el.querySelector('.shop-body') as HTMLElement;
    clear(host);
    if (this.tab === 'gear') this.renderGear(host);
    else if (this.tab === 'supplies') this.renderSupplies(host);
    else this.renderGems(host);
  }

  private priceOf(item: ItemInstance): number {
    const tier = rarityById(item.rarity);
    return Math.max(15, Math.round(item.power * 2.6 * tier.mult) + item.ilvl * 4);
  }

  private renderGear(host: HTMLElement) {
    const grid = document.createElement('div');
    grid.className = 'shop-grid';
    for (const item of stall!.stock) {
      if (stall!.bought.has(item.uid)) continue;
      const price = this.priceOf(item);
      const tile = itemTile(item, {
        price,
        upgrade: this.ctx.state.isUpgrade(item),
        onClick: () => this.openGear(item, price)
      });
      if (this.ctx.state.stats.gold < price) tile.classList.add('is-unaffordable');

      // A bare icon says nothing about what's for sale, so the stall labels
      // each tile with the item's name and slot.
      const cell = document.createElement('div');
      cell.className = 'shop-cell';
      cell.style.setProperty('--rc', rarityVar(item.rarity));
      cell.appendChild(tile);
      const caption = document.createElement('span');
      caption.className = 'shop-cell-name';
      caption.textContent = item.name;
      caption.title = item.name;
      cell.appendChild(caption);
      const slot = document.createElement('span');
      slot.className = 'shop-cell-slot';
      slot.textContent = SLOT_LABEL[item.slot];
      cell.appendChild(slot);
      grid.appendChild(cell);
    }
    if (!grid.children.length) {
      const empty = document.createElement('p');
      empty.className = 'shop-empty';
      empty.textContent = 'Cleaned out. The next trader will have fresh stock.';
      host.appendChild(empty);
      return;
    }
    host.appendChild(grid);
  }

  private openGear(item: ItemInstance, price: number) {
    const state = this.ctx.state;
    const afford = state.stats.gold >= price;
    this.closeSheet?.();
    this.closeSheet = openSheet(this.el, itemDetail(item, state.equipment[item.slot]), [
      {
        label: afford ? `Buy — ${price} 🪙` : `Need ${price - state.stats.gold} more 🪙`,
        kind: afford ? 'primary' : 'ghost',
        disabled: !afford,
        onClick: () => {
          if (!state.spendGold(price)) return;
          if (!state.addItem(item)) {
            state.stats.gold += price;
            this.ctx.toast('Bag is full', 'bad');
            return;
          }
          stall!.bought.add(item.uid);
          this.ctx.audio.play('coin');
          this.ctx.toast(`Bought ${item.name}`, 'good');
          this.ctx.save();
          this.closeSheet?.();
          this.syncPurse();
          this.render();
        }
      },
      { label: 'Close', kind: 'ghost', onClick: () => this.closeSheet?.() }
    ]);
  }

  private renderSupplies(host: HTMLElement) {
    const level = this.ctx.state.stats.level;
    const list = document.createElement('div');
    list.className = 'shop-list';
    for (const c of CONSUMABLES.filter(c => c.minLevel <= level + 2)) {
      list.appendChild(this.supplyRow(c));
    }
    host.appendChild(list);
  }

  private supplyRow(c: ConsumableDef): HTMLElement {
    const state = this.ctx.state;
    const rowEl = document.createElement('div');
    rowEl.className = `shop-row rarity-${c.tone}`;
    rowEl.style.setProperty('--rc', `var(--r-${c.tone})`);
    rowEl.innerHTML = `
      <span class="shop-row-icon">${c.icon}</span>
      <span class="shop-row-text">
        <b>${c.name}</b>
        <u>${c.description}</u>
        <em>Carrying ${state.consumableCount(c.id)}</em>
      </span>`;
    const buy = document.createElement('button');
    buy.className = 'btn btn-sm shop-buy';
    const refresh = () => {
      const afford = state.stats.gold >= c.price;
      buy.textContent = `${c.price} 🪙`;
      buy.disabled = !afford;
      buy.classList.toggle('btn-gold', afford);
      buy.classList.toggle('btn-ghost', !afford);
      (rowEl.querySelector('em') as HTMLElement).textContent = `Carrying ${state.consumableCount(c.id)}`;
    };
    buy.addEventListener('click', () => {
      if (!state.spendGold(c.price)) return;
      state.addConsumable(c.id, 1);
      this.ctx.audio.play('coin');
      this.ctx.save();
      this.syncPurse();
      refresh();
    });
    refresh();
    rowEl.appendChild(buy);
    return rowEl;
  }

  private renderGems(host: HTMLElement) {
    const note = document.createElement('p');
    note.className = 'shop-note';
    note.textContent = 'Store not connected yet — these are placeholders.';
    host.appendChild(note);

    const grid = document.createElement('div');
    grid.className = 'shop-packs';
    for (const pack of GEM_PACKS) {
      const card = document.createElement('button');
      card.className = 'shop-pack btn';
      card.innerHTML = `
        ${pack.tag ? `<span class="shop-pack-tag">${pack.tag}</span>` : ''}
        <span class="shop-pack-icon">${pack.icon}</span>
        <b class="shop-pack-gems">${pack.gems} 💎</b>
        <u class="shop-pack-price">${pack.price}</u>`;
      card.addEventListener('click', () => {
        this.ctx.audio.play('ui_back');
        this.ctx.toast('In-app purchases are not enabled yet.', 'info');
      });
      grid.appendChild(card);
    }
    host.appendChild(grid);

    // A free daily gem trickle keeps the tab useful before billing exists.
    const free = document.createElement('button');
    free.className = 'btn btn-gold btn-block shop-free';
    free.innerHTML = `<i>📺</i><span>Free 10 💎<u>Watch a short ad</u></span>`;
    free.addEventListener('click', () => {
      this.ctx.state.addGems(10);
      this.ctx.audio.play('coin');
      this.ctx.toast('+10 gems (ad placeholder)', 'good');
      this.ctx.save();
      this.syncPurse();
    });
    host.appendChild(free);
  }
}


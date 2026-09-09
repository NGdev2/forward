import type { GameContext, Screen, ScreenParams, ShopParams } from '../core/context';
import type { ItemInstance, Rarity } from '../game/types';
import { addLuckCharges, activeLuckBonus, makeItem, rollShopStock } from '../game/loot';
import { CONSUMABLES, consumableById, type ConsumableDef, supplyPrice } from '../game/data/consumables';
import { ITEM_SETS, setPieces, wornSetCounts, type ItemSet } from '../game/data/items';
import { GameState } from '../game/state';
import { clear, el, elementBadge, esc, itemDetail, itemTile, openSheet, rarityVar, sortItems } from './inventory/ui';
import { rarityById } from '../game/config';
import { desc as cdesc, fmtNum, itemDisplayName, name as cname, rarityLabel, slotLabel, t, tn } from '../i18n';

/* ============================================================================
 * The wayside trader. Reached ONLY from a trader lane on the road.
 *
 * Tabs: Gear · Supplies · Relics (gem-only specials) · Sell · Gems (placeholder
 * IAP surface). Every gear/supply item can be paid for in gold OR gems; the
 * relics are what gems are *for*.
 *
 * Stock is rolled once per visit and cached on the module so hopping to the
 * bag (to sell something) and back keeps the same wares. `closeStall()` is the
 * only thing that discards it, and only "Back to the road" calls it.
 * ========================================================================== */

type Currency = 'gold' | 'gems';

interface Stall {
  stock: ItemInstance[];
  bought: Set<string>;
  /** The guaranteed set piece on the Relics tab. */
  relic: ItemInstance | null;
  relicGems: number;
  /** One-per-visit specials already taken. */
  taken: Set<string>;
}

let stall: Stall | null = null;

/** Called when the player leaves the shop node, so the next trader is new. */
export function closeStall() {
  stall = null;
}

type Tab = 'gear' | 'supplies' | 'relics' | 'sell' | 'gems';

/* Labels are looked up at mount time so a language change applies on the next visit. */
const TAB_DEFS: { id: Tab; key: string }[] = [
  { id: 'gear', key: 'shop.tab_gear' },
  { id: 'supplies', key: 'shop.tab_supplies' },
  { id: 'relics', key: 'shop.tab_relics' },
  { id: 'sell', key: 'common.sell' },
  { id: 'gems', key: 'common.gems' }
];

/** Placeholder gem bundles. No billing SDK is wired up yet, by design. */
const GEM_PACKS = [
  { id: 'gems_s', gems: 100, price: '$0.99', tag: '', icon: '💎' },
  { id: 'gems_m', gems: 550, price: '$4.99', tag: '+10%', icon: '💠' },
  { id: 'gems_l', gems: 1200, price: '$9.99', tag: 'shop.best_value', icon: '🔷' }
];

const BAG_STEP = 6;
const INCENSE_GEMS = 30;
const INCENSE_LUCK = 18;
const INCENSE_DROPS = 12;
const BUNDLE_GEMS = 25;
const BUNDLE: { id: string; n: number }[] = [
  { id: 'potion_small', n: 3 },
  { id: 'ether', n: 1 }
];

/** Two-line label for a buy button the player can't afford yet. */
function need(short: number, icon: string): string {
  return `<span class="btn-need"><i>${esc(t('shop.need'))}</i>${esc(t('shop.need_more', { n: short, icon }))}</span>`;
}

const gold = (n: number) => t('common.gold_short', { n: fmtNum(n) });

/** Gold → gem conversion for anything that has a gold price: 20 gold per gem, minimum 2. */
export function gemPrice(gold: number): number {
  return Math.max(2, Math.ceil(gold / 20));
}

/** Gold price of a piece of trader gear. */
export function gearPrice(item: ItemInstance): number {
  const tier = rarityById(item.rarity);
  return Math.max(15, Math.round(item.power * 2.6 * tier.mult) + item.ilvl * 4);
}

/** Bag expansion cost climbs with the current cap so the last slots cost most. */
export function bagPrice(cap: number): number {
  return 20 + Math.max(0, cap - 24) * 5;
}

/** The set whose level band is nearest at-or-below `level + 4` (first set as floor). */
function setForLevel(level: number): ItemSet {
  const target = level + 4;
  let best: ItemSet | null = null;
  for (const set of ITEM_SETS) {
    if (set.level <= target && (!best || set.level > best.level)) best = set;
  }
  return best ?? ITEM_SETS[0];
}

function rollRelic(level: number): ItemInstance | null {
  const set = setForLevel(level);
  const pieces = setPieces(set.id);
  if (pieces.length === 0) return null;
  const base = pieces[Math.floor(Math.random() * pieces.length)];
  const r = Math.random();
  const rarity: Rarity = r > 0.95 ? 'mythic' : r > 0.7 ? 'legendary' : 'epic';
  return makeItem(base.id, rarity, Math.max(level, set.level));
}

function newStall(level: number): Stall {
  const relic = rollRelic(level);
  return {
    stock: rollShopStock(level, 6),
    bought: new Set(),
    relic,
    relicGems: relic ? Math.max(25, Math.ceil(gearPrice(relic) / 8)) : 0,
    taken: new Set()
  };
}

export class ShopScreen implements Screen {
  readonly id = 'shop' as const;

  private ctx!: GameContext;
  private el!: HTMLElement;
  private tab: Tab = 'gear';
  private cleanups: (() => void)[] = [];
  private closeSheet: (() => void) | null = null;

  mount(root: HTMLElement, ctx: GameContext, params: ScreenParams) {
    this.ctx = ctx;
    const p = params as ShopParams;
    this.tab = TAB_DEFS.some(t => t.id === p.tab) ? (p.tab as Tab) : 'gear';
    this.closeSheet = null;
    if (!stall) stall = newStall(ctx.state.stats.level);
    ctx.music.setMode('shop');

    const el = document.createElement('div');
    el.className = 'screen screen-shop';
    el.innerHTML = `
      <div class="shop-top topbar">
        <button class="icon-btn shop-back" aria-label="${esc(t('shop.back_road'))}">←</button>
        <div class="topbar-title">${esc(t('shop.title'))}</div>
        <div class="shop-purse">
          <span class="chip chip-gold"><i>🪙</i><b class="shop-gold">0</b></span>
          <span class="chip chip-gem"><i>💎</i><b class="shop-gems">0</b></span>
        </div>
        <button class="icon-btn shop-bag" aria-label="${esc(t('shop.open_bag'))}">🎒</button>
      </div>
      <div class="shop-greet">
        <span class="shop-keeper">🧙</span>
        <p class="shop-line">${esc(t('shop.greet'))}</p>
      </div>
      <div class="shop-tabs seg">
        ${TAB_DEFS.map(d => `<button class="seg-btn${d.id === this.tab ? ' is-on' : ''}" data-tab="${d.id}">${esc(t(d.key))}</button>`).join('')}
      </div>
      <div class="shop-body"></div>
      <div class="shop-foot">
        <button class="btn btn-primary btn-block btn-cta shop-leave">${esc(t('shop.leave'))}</button>
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

    this.bind('.shop-back', 'ui_back', () => this.leave());
    this.bind('.shop-leave', 'ui_back', () => this.leave());
    // The bag keeps the stall alive: sell something, come back, same stock.
    this.bind('.shop-bag', 'ui_tap', () => this.ctx.goto('inventory', { from: 'shop', tab: 'bag' }));

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

  /** The only exit that forgets the stall. */
  private leave() {
    closeStall();
    this.ctx.save();
    this.ctx.goto('run');
  }

  private bind(sel: string, sfx: 'ui_tap' | 'ui_back', fn: () => void) {
    const node = this.el.querySelector(sel) as HTMLElement | null;
    if (!node) return;
    const handler = () => {
      this.ctx.audio.play(sfx);
      fn();
    };
    node.addEventListener('click', handler);
    this.cleanups.push(() => node.removeEventListener('click', handler));
  }

  private syncPurse() {
    (this.el.querySelector('.shop-gold') as HTMLElement).textContent = fmtNum(this.ctx.state.stats.gold);
    (this.el.querySelector('.shop-gems') as HTMLElement).textContent = String(this.ctx.state.stats.gems);
  }

  /** Spends in the chosen currency; false (and a toast) when short. */
  private pay(currency: Currency, gold: number, gems: number): boolean {
    const state = this.ctx.state;
    const ok = currency === 'gold' ? state.spendGold(gold) : state.spendGems(gems);
    if (!ok) {
      const short = currency === 'gold' ? gold - state.stats.gold : gems - state.stats.gems;
      this.ctx.toast(t('shop.need_short', { n: short, icon: currency === 'gold' ? '🪙' : '💎' }), 'bad');
    }
    return ok;
  }

  private refund(currency: Currency, gold: number, gems: number) {
    if (currency === 'gold') this.ctx.state.stats.gold += gold;
    else this.ctx.state.stats.gems += gems;
  }

  private afterPurchase() {
    this.ctx.save();
    this.syncPurse();
    this.render();
  }

  /* --------------------------------------------------------------- tabs -- */

  private render() {
    const host = this.el.querySelector('.shop-body') as HTMLElement;
    clear(host);
    host.scrollTop = 0;
    switch (this.tab) {
      case 'gear':
        this.renderGear(host);
        break;
      case 'supplies':
        this.renderSupplies(host);
        break;
      case 'relics':
        this.renderRelics(host);
        break;
      case 'sell':
        this.renderSell(host);
        break;
      default:
        this.renderGems(host);
    }
  }

  /* --------------------------------------------------------------- gear -- */

  private renderGear(host: HTMLElement) {
    const state = this.ctx.state;
    const grid = el('div', 'shop-grid');
    for (const item of stall!.stock) {
      if (stall!.bought.has(item.uid)) continue;
      const gold = gearPrice(item);
      const gems = gemPrice(gold);
      const tile = itemTile(item, {
        upgrade: state.isUpgrade(item),
        onClick: () => this.openGear(item)
      });
      const affordable = state.stats.gold >= gold || state.stats.gems >= gems;
      if (!affordable) tile.classList.add('is-unaffordable');

      // A bare icon says nothing about what's for sale, so the stall labels
      // each tile with the item's name, slot and both prices.
      const cell = el('div', 'shop-cell');
      cell.style.setProperty('--rc', rarityVar(item.rarity));
      cell.appendChild(tile);
      const caption = el('span', 'shop-cell-name', esc(itemDisplayName(item)));
      caption.title = itemDisplayName(item);
      cell.appendChild(caption);
      cell.appendChild(el('span', 'shop-cell-slot', esc(slotLabel(item.slot))));
      cell.appendChild(
        el(
          'span',
          'shop-cell-price',
          `<b class="${state.stats.gold >= gold ? '' : 'is-short'}">${gold} 🪙</b><b class="${state.stats.gems >= gems ? '' : 'is-short'}">${gems} 💎</b>`
        )
      );
      grid.appendChild(cell);
    }
    if (!grid.children.length) {
      host.appendChild(this.empty('🧺', t('shop.cleaned_out'), t('shop.cleaned_out_note')));
      return;
    }
    host.appendChild(el('p', 'shop-note', esc(t('shop.pay_note'))));
    host.appendChild(grid);
  }

  /** Item sheet with a button per currency. */
  private openGear(item: ItemInstance) {
    const state = this.ctx.state;
    const goldPrice = gearPrice(item);
    const gems = gemPrice(goldPrice);
    const canGold = state.stats.gold >= goldPrice;
    const canGems = state.stats.gems >= gems;
    const buy = (currency: Currency) => {
      if (!this.pay(currency, goldPrice, gems)) return;
      if (!state.addItem(item)) {
        this.refund(currency, goldPrice, gems);
        this.ctx.toast(t('shop.bag_full_sell'), 'bad');
        return;
      }
      stall!.bought.add(item.uid);
      this.ctx.audio.play('coin');
      this.ctx.toast(t('shop.bought', { name: itemDisplayName(item) }), 'good');
      this.closeSheet?.();
      this.closeSheet = null;
      this.afterPurchase();
    };
    this.closeSheet?.();
    this.closeSheet = openSheet(this.el, itemDetail(item, state.equipment[item.slot], state.equipment), [
      {
        label: canGold ? esc(t('shop.buy_for', { n: goldPrice, icon: '🪙' })) : need(goldPrice - state.stats.gold, '🪙'),
        kind: 'gold',
        disabled: !canGold,
        onClick: () => buy('gold')
      },
      {
        label: canGems ? esc(t('shop.buy_for', { n: gems, icon: '💎' })) : need(gems - state.stats.gems, '💎'),
        kind: 'primary',
        disabled: !canGems,
        onClick: () => buy('gems')
      },
      { label: esc(t('common.close')), kind: 'ghost', onClick: () => this.closeSheet?.() }
    ]);
  }

  /* ----------------------------------------------------------- supplies -- */

  private renderSupplies(host: HTMLElement) {
    const level = this.ctx.state.stats.level;
    const list = el('div', 'shop-list');
    for (const c of CONSUMABLES.filter(c => c.minLevel <= level + 2)) list.appendChild(this.supplyRow(c));
    host.appendChild(list);
  }

  private supplyRow(c: ConsumableDef): HTMLElement {
    const state = this.ctx.state;
    const price = supplyPrice(c, state.stats.level);
    const gems = gemPrice(price);
    const rowEl = el('div', `shop-row rarity-${c.tone}`);
    rowEl.style.setProperty('--rc', `var(--r-${c.tone})`);
    rowEl.innerHTML = `
      <span class="shop-row-icon">${c.icon}</span>
      <span class="shop-row-text">
        <b>${esc(cname('consumable', c.id, c.name))}</b>
        <u>${esc(cdesc('consumable', c.id, c.description))}</u>
        <em>${esc(t('shop.carrying', { n: state.consumableCount(c.id) }))}</em>
      </span>`;
    const pay = el('div', 'shop-pay');
    const goldBtn = el('button', 'btn btn-sm btn-gold shop-buy');
    const gemBtn = el('button', 'btn btn-sm btn-primary shop-buy');
    goldBtn.setAttribute('aria-label', t('shop.buy_aria_gold', { name: cname('consumable', c.id, c.name), n: price }));
    gemBtn.setAttribute('aria-label', t('shop.buy_aria_gems', { name: cname('consumable', c.id, c.name), n: gems }));
    const refresh = () => {
      goldBtn.textContent = `${price} 🪙`;
      gemBtn.textContent = `${gems} 💎`;
      goldBtn.disabled = state.stats.gold < price;
      gemBtn.disabled = state.stats.gems < gems;
      (rowEl.querySelector('em') as HTMLElement).textContent = t('shop.carrying', { n: state.consumableCount(c.id) });
    };
    const buy = (currency: Currency) => {
      if (!this.pay(currency, price, gems)) return;
      state.addConsumable(c.id, 1);
      this.ctx.audio.play('coin');
      this.ctx.save();
      this.syncPurse();
      // Only this row changes; leave the list where the player scrolled it.
      for (const row of Array.from(this.el.querySelectorAll<HTMLElement>('.shop-row'))) {
        row.dispatchEvent(new CustomEvent('shop:refresh'));
      }
    };
    goldBtn.addEventListener('click', () => buy('gold'));
    gemBtn.addEventListener('click', () => buy('gems'));
    rowEl.addEventListener('shop:refresh', refresh);
    refresh();
    pay.appendChild(goldBtn);
    pay.appendChild(gemBtn);
    rowEl.appendChild(pay);
    return rowEl;
  }

  /* ------------------------------------------------------------- relics -- */

  private renderRelics(host: HTMLElement) {
    const state = this.ctx.state;
    host.appendChild(el('p', 'shop-note', esc(t('shop.relics_note'))));
    const list = el('div', 'shop-list');

    // 1. Guaranteed set piece for the player's level band.
    const relic = stall!.relic;
    if (relic && !stall!.taken.has('relic')) {
      const set = ITEM_SETS.find(s => s.id === relic.setId)!;
      const worn = wornSetCounts(state.equipment).get(set.id) ?? 0;
      const card = el('div', 'shop-relic');
      card.style.setProperty('--rc', rarityVar(relic.rarity));
      card.style.setProperty('--el', `var(--el-${set.element})`);
      const tile = itemTile(relic, { upgrade: state.isUpgrade(relic), onClick: () => this.openRelic(relic, set) });
      card.appendChild(tile);
      const text = el('span', 'shop-row-text');
      text.innerHTML = `
        <b>${esc(itemDisplayName(relic))}</b>
        <u>${esc(t('shop.relic_sub', { rarity: rarityLabel(relic.rarity), slot: slotLabel(relic.slot), power: relic.power }))}</u>
        <span class="shop-relic-set"><i>${set.icon} ${esc(cname('set', set.id, set.name))}</i> <em>${esc(t('shop.relic_worn', { n: worn, total: setPieces(set.id).length }))}</em></span>`;
      text.querySelector('.shop-relic-set')!.appendChild(elementBadge(set.element));
      card.appendChild(text);
      card.appendChild(this.gemButton(stall!.relicGems, () => this.openRelic(relic, set)));
      list.appendChild(card);
    } else if (relic) {
      list.appendChild(this.specialRow('🏵️', t('shop.relic_claimed'), t('shop.relic_claimed_note'), 'epic', null));
    }

    // 2. Bag expansion — repeatable until the ceiling.
    const cap = state.stats.inventoryCap;
    const bagMaxed = cap >= GameState.BAG_CAP_MAX;
    list.appendChild(
      this.specialRow(
        '🎒',
        t('shop.bag_expansion', { n: BAG_STEP }),
        bagMaxed ? t('shop.bag_maxed', { n: cap }) : t('shop.bag_next', { from: cap, to: Math.min(GameState.BAG_CAP_MAX, cap + BAG_STEP) }),
        'rare',
        bagMaxed
          ? null
          : {
              gems: bagPrice(cap),
              onBuy: () => {
                if (!this.pay('gems', 0, bagPrice(cap))) return;
                const next = state.expandBag(BAG_STEP);
                this.ctx.audio.play('levelup');
                this.ctx.toast(t('shop.bag_holds', { n: next }), 'good');
                this.afterPurchase();
              }
            }
      )
    );

    // 3. Fortune incense — luck charges for the next drops.
    const luck = activeLuckBonus();
    list.appendChild(
      this.specialRow(
        '🕯️',
        t('shop.incense'),
        luck.dropsLeft > 0
          ? t('shop.incense_burning', { bonus: luck.bonus, n: luck.dropsLeft })
          : t('shop.incense_note', { n: INCENSE_DROPS }),
        'legendary',
        stall!.taken.has('incense')
          ? null
          : {
              gems: INCENSE_GEMS,
              onBuy: () => {
                if (!this.pay('gems', 0, INCENSE_GEMS)) return;
                addLuckCharges(INCENSE_LUCK, INCENSE_DROPS);
                stall!.taken.add('incense');
                this.ctx.audio.play('magic');
                this.ctx.toast(t('shop.fortune_toast'), 'legendary');
                this.afterPurchase();
              }
            }
      )
    );

    // 4. Trader's bundle — potions + an ether, repeatable.
    const bundleText = BUNDLE.map(b => t('shop.bundle_item', { n: b.n, name: cname('consumable', b.id, consumableById(b.id)?.name ?? b.id) })).join(' + ');
    list.appendChild(
      this.specialRow('🎁', t('shop.bundle'), bundleText, 'uncommon', {
        gems: BUNDLE_GEMS,
        onBuy: () => {
          if (!this.pay('gems', 0, BUNDLE_GEMS)) return;
          for (const b of BUNDLE) state.addConsumable(b.id, b.n);
          this.ctx.audio.play('coin');
          this.ctx.toast(t('shop.bundle_packed'), 'good');
          this.afterPurchase();
        }
      })
    );

    host.appendChild(list);
  }

  private openRelic(relic: ItemInstance, set: ItemSet) {
    const state = this.ctx.state;
    const gems = stall!.relicGems;
    const can = state.stats.gems >= gems;
    this.closeSheet?.();
    this.closeSheet = openSheet(this.el, itemDetail(relic, state.equipment[relic.slot], state.equipment), [
      {
        label: can ? esc(t('shop.buy_for', { n: gems, icon: '💎' })) : need(gems - state.stats.gems, '💎'),
        kind: 'primary',
        disabled: !can,
        onClick: () => {
          if (!this.pay('gems', 0, gems)) return;
          if (!state.addItem(relic)) {
            this.refund('gems', 0, gems);
            this.ctx.toast(t('shop.bag_full_sell'), 'bad');
            return;
          }
          stall!.taken.add('relic');
          this.ctx.audio.play('legendary');
          this.ctx.toast(t('shop.yours', { icon: set.icon, name: itemDisplayName(relic) }), 'legendary');
          this.closeSheet?.();
          this.closeSheet = null;
          this.afterPurchase();
        }
      },
      { label: esc(t('common.close')), kind: 'ghost', onClick: () => this.closeSheet?.() }
    ]);
  }

  private specialRow(
    icon: string,
    title: string,
    desc: string,
    tone: string,
    offer: { gems: number; onBuy: () => void } | null
  ): HTMLElement {
    const row = el('div', `shop-row shop-special rarity-${tone}`);
    row.style.setProperty('--rc', `var(--r-${tone})`);
    row.innerHTML = `
      <span class="shop-row-icon">${icon}</span>
      <span class="shop-row-text"><b>${esc(title)}</b><u>${esc(desc)}</u></span>`;
    if (offer) row.appendChild(this.gemButton(offer.gems, offer.onBuy));
    else row.appendChild(el('span', 'shop-sold', esc(t('common.done'))));
    return row;
  }

  private gemButton(gems: number, onBuy: () => void): HTMLButtonElement {
    const btn = el('button', 'btn btn-primary shop-buy shop-buy-gem');
    const short = gems - this.ctx.state.stats.gems;
    btn.innerHTML = short > 0 ? `<span>${gems} 💎</span><u>${esc(t('shop.need_n', { n: short }))}</u>` : `<span>${gems} 💎</span>`;
    btn.disabled = short > 0;
    btn.addEventListener('click', onBuy);
    return btn;
  }

  /* --------------------------------------------------------------- sell -- */

  private junkItems(): ItemInstance[] {
    const state = this.ctx.state;
    return state.stats.inventory.filter(i => {
      const worn = state.equipment[i.slot];
      return Boolean(worn) && i.power < worn!.power;
    });
  }

  private renderSell(host: HTMLElement) {
    const state = this.ctx.state;
    const items = sortItems(state.stats.inventory, 'power');
    if (items.length === 0) {
      host.appendChild(this.empty('🎒', t('shop.nothing_to_sell'), t('shop.nothing_to_sell_note')));
      return;
    }

    const junk = this.junkItems();
    const junkValue = junk.reduce((sum, i) => sum + state.sellValue(i), 0);
    const bar = el('div', 'shop-junk');
    bar.innerHTML = `<span>${esc(tn('shop.junk', junk.length)).replace(/^(\d+)/, '<b>$1</b>')}<u>${esc(t('shop.junk_note'))}</u></span>`;
    const sellAll = el('button', 'btn btn-gold shop-junk-btn', esc(t('shop.sell_all_junk', { n: junkValue })));
    sellAll.disabled = junk.length === 0;
    sellAll.addEventListener('click', () => {
      let earned = 0;
      for (const item of this.junkItems()) earned += state.sellItem(item.uid);
      this.ctx.audio.play('coin');
      this.ctx.toast(t('inventory.sold_many', { n: junk.length, gold: gold(earned) }), 'good');
      this.afterPurchase();
    });
    bar.appendChild(sellAll);
    host.appendChild(bar);

    const list = el('div', 'shop-list');
    for (const item of items) {
      const value = state.sellValue(item);
      const row = el('div', `shop-row shop-sell-row${junk.includes(item) ? ' is-junk' : ''}`);
      row.style.setProperty('--rc', rarityVar(item.rarity));
      row.innerHTML = `
        <span class="shop-row-icon">${item.icon}</span>
        <span class="shop-row-text">
          <b>${esc(itemDisplayName(item))}</b>
          <u>${esc(t('shop.relic_sub', { rarity: rarityLabel(item.rarity), slot: slotLabel(item.slot), power: item.power }))}${junk.includes(item) ? ` · ${esc(t('shop.junk'))}` : state.isUpgrade(item) ? ` · ▲ ${esc(t('shop.upgrade'))}` : ''}</u>
        </span>`;
      const btn = el('button', 'btn btn-gold btn-sm shop-buy', `+${value} 🪙`);
      btn.setAttribute('aria-label', t('shop.sell_aria', { name: itemDisplayName(item), n: value }));
      btn.addEventListener('click', () => {
        const earned = state.sellItem(item.uid);
        this.ctx.audio.play('coin');
        this.ctx.toast(t('inventory.sold_for', { gold: gold(earned) }), 'good');
        this.afterPurchase();
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
    host.appendChild(list);
  }

  /* --------------------------------------------------------------- gems -- */

  private renderGems(host: HTMLElement) {
    host.appendChild(el('p', 'shop-note', esc(t('shop.store_note'))));

    const grid = el('div', 'shop-packs');
    for (const pack of GEM_PACKS) {
      const card = el('button', 'shop-pack btn');
      card.innerHTML = `
        ${pack.tag ? `<span class="shop-pack-tag">${esc(pack.tag.startsWith('shop.') ? t(pack.tag) : pack.tag)}</span>` : ''}
        <span class="shop-pack-icon">${pack.icon}</span>
        <b class="shop-pack-gems">${pack.gems} 💎</b>
        <u class="shop-pack-price">${pack.price}</u>`;
      card.addEventListener('click', () => {
        this.ctx.audio.play('ui_back');
        this.ctx.toast(t('shop.iap_disabled'), 'info');
      });
      grid.appendChild(card);
    }
    host.appendChild(grid);

    // A free gem trickle keeps the tab useful before billing exists.
    const free = el('button', 'btn btn-gold btn-block shop-free');
    free.innerHTML = `<i>📺</i><span>${esc(t('shop.free_gems'))}<u>${esc(t('shop.watch_ad'))}</u></span>`;
    free.addEventListener('click', () => {
      this.ctx.state.addGems(10);
      this.ctx.audio.play('coin');
      this.ctx.toast(t('shop.free_gems_toast'), 'good');
      this.ctx.save();
      this.syncPurse();
    });
    host.appendChild(free);
  }

  /* -------------------------------------------------------------- utils -- */

  private empty(icon: string, title: string, note: string): HTMLElement {
    return el('div', 'empty', `<div class="empty-icon">${icon}</div><div class="empty-title">${esc(title)}</div><div>${esc(note)}</div>`);
  }
}

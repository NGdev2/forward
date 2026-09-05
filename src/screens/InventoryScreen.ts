import type { GameContext, Screen, ScreenParams } from '../core/context';
import type { EquipSlot, ItemInstance } from '../game/types';
import { EQUIP_SLOTS } from '../game/types';
import { lookFromEquipment } from '../render/api';
import { STAT_ICONS, formatStat } from '../game/config';
import { addLuckCharges, activeLuckBonus } from '../game/loot';
import { ITEM_SETS, setPieces } from '../game/data/items';
import { consumableById, fieldConsumables } from '../game/data/consumables';
import {
  SLOT_ICON,
  SLOT_LABEL,
  type SortMode,
  clear,
  el,
  itemDetail,
  itemTile,
  openSheet,
  rarityClass,
  rarityVar,
  sortItems
} from './inventory/ui';

type Tab = 'bag' | 'stats' | 'sets' | 'items';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'bag', label: 'Bag', icon: '🎒' },
  { id: 'stats', label: 'Stats', icon: '📊' },
  { id: 'sets', label: 'Sets', icon: '🏵️' },
  { id: 'items', label: 'Items', icon: '🧪' }
];

const SORTS: { id: SortMode; label: string }[] = [
  { id: 'power', label: 'Power' },
  { id: 'rarity', label: 'Rarity' },
  { id: 'slot', label: 'Slot' },
  { id: 'recent', label: 'New' }
];

export class InventoryScreen implements Screen {
  readonly id = 'inventory' as const;

  private ctx!: GameContext;
  private root!: HTMLElement;
  private dollHost!: HTMLElement;
  private portraitHost!: HTMLElement;
  private headerHost!: HTMLElement;
  private panel!: HTMLElement;
  private tabBar!: HTMLElement;
  private closeSheet: (() => void) | null = null;

  private tab: Tab = 'bag';
  private sort: SortMode = 'power';
  private filter: EquipSlot | 'all' = 'all';
  private t = 0;

  mount(root: HTMLElement, ctx: GameContext, _params: ScreenParams) {
    this.ctx = ctx;
    const screen = el('div', 'screen screen-inventory');
    this.root = screen;
    root.appendChild(screen);

    this.headerHost = el('div', 'inv-header');
    screen.appendChild(this.headerHost);

    this.dollHost = el('div', 'paperdoll');
    screen.appendChild(this.dollHost);

    this.tabBar = el('div', 'inv-tabs');
    screen.appendChild(this.tabBar);

    this.panel = el('div', 'inv-panel');
    screen.appendChild(this.panel);

    this.renderHeader();
    this.renderDoll();
    this.renderTabs();
    this.renderPanel();
  }

  update(dt: number) {
    this.t += dt;
  }

  unmount() {
    this.closeSheet?.();
    this.closeSheet = null;
  }

  /* ------------------------------------------------------------- header -- */

  private renderHeader() {
    const s = this.ctx.state.stats;
    clear(this.headerHost);

    const back = el('button', 'icon-btn inv-back', '‹');
    back.setAttribute('aria-label', 'Back to the road');
    back.addEventListener('click', () => {
      this.ctx.audio.play('ui_back');
      this.ctx.goto('run');
    });
    this.headerHost.appendChild(back);

    const title = el('div', 'inv-title');
    title.innerHTML = `<b>Level ${s.level}</b><span>Cycle ${s.worldCycle + 1}</span>`;
    this.headerHost.appendChild(title);

    const purse = el('div', 'inv-purse');
    purse.innerHTML = `
      <span class="chip chip-gold">🪙 ${s.gold.toLocaleString()}</span>
      <span class="chip chip-gem">💎 ${s.gems}</span>
    `;
    this.headerHost.appendChild(purse);

    const shop = el('button', 'icon-btn inv-shop', '🏪');
    shop.setAttribute('aria-label', 'Open the shop');
    shop.addEventListener('click', () => {
      this.ctx.audio.play('ui_tap');
      this.ctx.goto('shop');
    });
    this.headerHost.appendChild(shop);
  }

  /* --------------------------------------------------------- paper doll -- */

  private renderDoll() {
    const eq = this.ctx.state.equipment;
    clear(this.dollHost);

    const left = el('div', 'doll-col doll-left');
    const right = el('div', 'doll-col doll-right');
    const centre = el('div', 'doll-centre');

    const leftSlots: EquipSlot[] = ['helm', 'armor', 'boots'];
    const rightSlots: EquipSlot[] = ['weapon', 'offhand', 'trinket'];
    for (const slot of leftSlots) left.appendChild(this.slotButton(slot, eq[slot]));
    for (const slot of rightSlots) right.appendChild(this.slotButton(slot, eq[slot]));

    this.portraitHost = el('div', 'doll-portrait');
    centre.appendChild(this.portraitHost);
    this.drawPortrait();

    const d = this.ctx.state.derived;
    const quick = el('div', 'doll-quick');
    quick.innerHTML = `
      <span><i>⚔</i>${d.atk}</span>
      <span><i>🛡</i>${d.def}</span>
      <span><i>❤</i>${this.ctx.state.stats.hp}/${d.maxHp}</span>
      <span class="q-power"><i>✦</i>${d.power}</span>
    `;
    centre.appendChild(quick);

    this.dollHost.appendChild(left);
    this.dollHost.appendChild(centre);
    this.dollHost.appendChild(right);
  }

  private drawPortrait() {
    clear(this.portraitHost);
    const size = 148;
    try {
      const canvas = this.ctx.sprites.heroPortrait(lookFromEquipment(this.ctx.state.equipment), size);
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      this.portraitHost.appendChild(canvas);
    } catch {
      this.portraitHost.textContent = '🧍';
    }
  }

  private slotButton(slot: EquipSlot, item: ItemInstance | null): HTMLElement {
    const btn = el('button', `doll-slot${item ? ' is-filled' : ''}`);
    if (item) {
      btn.classList.add(rarityClass(item.rarity));
      btn.style.setProperty('--rc', rarityVar(item.rarity));
      btn.innerHTML = `
        <span class="ds-icon">${item.icon}</span>
        <span class="ds-name">${item.name}</span>
        <span class="ds-power">${item.power}</span>
      `;
    } else {
      btn.innerHTML = `
        <span class="ds-icon ds-empty">${SLOT_ICON[slot]}</span>
        <span class="ds-name">${SLOT_LABEL[slot]}</span>
        <span class="ds-power">—</span>
      `;
    }
    btn.addEventListener('click', () => {
      this.ctx.audio.play('ui_tap');
      if (item) this.openItem(item, true);
      else this.openSlotPicker(slot);
    });
    return btn;
  }

  /** Tapping an empty slot lists everything in the bag that fits it. */
  private openSlotPicker(slot: EquipSlot) {
    const options = this.ctx.state.stats.inventory.filter(i => i.slot === slot);
    const body = el('div', 'picker');
    body.appendChild(el('div', 'picker-head', `${SLOT_ICON[slot]} ${SLOT_LABEL[slot]}`));
    if (options.length === 0) {
      body.appendChild(el('div', 'picker-empty', 'Nothing in your bag fits this slot yet.'));
    } else {
      const grid = el('div', 'picker-grid');
      for (const item of sortItems(options, 'power')) {
        grid.appendChild(
          itemTile(item, {
            upgrade: this.ctx.state.isUpgrade(item),
            onClick: it => {
              this.closeSheet?.();
              this.openItem(it, false);
            }
          })
        );
      }
      body.appendChild(grid);
    }
    this.closeSheet?.();
    this.closeSheet = openSheet(this.root, body, [
      { label: 'Close', kind: 'ghost', onClick: () => this.closeSheet?.() }
    ]);
  }

  /* ---------------------------------------------------------------- tabs -- */

  private renderTabs() {
    clear(this.tabBar);
    for (const tab of TABS) {
      const btn = el('button', `inv-tab${this.tab === tab.id ? ' is-active' : ''}`);
      const count =
        tab.id === 'bag'
          ? `<span class="tab-count">${this.ctx.state.bagCount}/${this.ctx.state.stats.inventoryCap}</span>`
          : '';
      btn.innerHTML = `<i>${tab.icon}</i><span>${tab.label}</span>${count}`;
      btn.addEventListener('click', () => {
        if (this.tab === tab.id) return;
        this.tab = tab.id;
        this.ctx.audio.play('ui_tap');
        this.renderTabs();
        this.renderPanel();
      });
      this.tabBar.appendChild(btn);
    }
  }

  private renderPanel() {
    clear(this.panel);
    this.panel.scrollTop = 0;
    if (this.tab === 'bag') this.renderBag();
    else if (this.tab === 'stats') this.renderStats();
    else if (this.tab === 'sets') this.renderSets();
    else this.renderConsumables();
  }

  /* ----------------------------------------------------------------- bag -- */

  private renderBag() {
    const state = this.ctx.state;
    const tools = el('div', 'bag-tools');

    const sortRow = el('div', 'tool-row');
    sortRow.appendChild(el('span', 'tool-label', 'Sort'));
    for (const s of SORTS) {
      const chip = el('button', `chip chip-tap${this.sort === s.id ? ' is-on' : ''}`, s.label);
      chip.addEventListener('click', () => {
        this.sort = s.id;
        this.renderBag();
      });
      sortRow.appendChild(chip);
    }
    tools.appendChild(sortRow);

    const filterRow = el('div', 'tool-row tool-row-scroll');
    const mkFilter = (id: EquipSlot | 'all', label: string) => {
      const chip = el('button', `chip chip-tap${this.filter === id ? ' is-on' : ''}`, label);
      chip.addEventListener('click', () => {
        this.filter = id;
        this.renderBag();
      });
      return chip;
    };
    filterRow.appendChild(mkFilter('all', 'All'));
    for (const slot of EQUIP_SLOTS) filterRow.appendChild(mkFilter(slot, SLOT_ICON[slot]));
    tools.appendChild(filterRow);
    this.panel.appendChild(tools);

    const junk = this.junkItems();
    const junkBar = el('div', 'bag-junk');
    const junkValue = junk.reduce((sum, i) => sum + state.sellValue(i), 0);
    junkBar.innerHTML = `<span>${junk.length} junk item${junk.length === 1 ? '' : 's'}</span>`;
    const sellBtn = el('button', 'btn btn-gold btn-sm', `Sell all · ${junkValue}g`);
    sellBtn.disabled = junk.length === 0;
    sellBtn.addEventListener('click', () => this.sellJunk());
    junkBar.appendChild(sellBtn);
    this.panel.appendChild(junkBar);

    const items = state.stats.inventory.filter(i => this.filter === 'all' || i.slot === this.filter);
    const grid = el('div', 'bag-grid');
    for (const item of sortItems(items, this.sort)) {
      grid.appendChild(
        itemTile(item, {
          upgrade: state.isUpgrade(item),
          onClick: it => this.openItem(it, false)
        })
      );
    }
    const emptySlots = Math.max(0, state.stats.inventoryCap - state.bagCount);
    for (let i = 0; i < Math.min(emptySlots, 24); i++) grid.appendChild(el('div', 'bag-empty'));
    if (items.length === 0) {
      grid.appendChild(el('div', 'bag-hint', 'Your bag is empty — go find something shiny.'));
    }
    this.panel.appendChild(grid);
  }

  /** Junk = anything strictly worse than what you already wear in that slot. */
  private junkItems(): ItemInstance[] {
    const state = this.ctx.state;
    return state.stats.inventory.filter(i => {
      const worn = state.equipment[i.slot];
      return Boolean(worn) && i.power < worn!.power;
    });
  }

  private sellJunk() {
    const junk = this.junkItems();
    if (junk.length === 0) return;
    let gold = 0;
    for (const item of junk) gold += this.ctx.state.sellItem(item.uid);
    this.ctx.audio.play('coin');
    this.ctx.toast(`Sold ${junk.length} items for ${gold}g`, 'good');
    this.ctx.save();
    this.renderHeader();
    this.renderTabs();
    this.renderBag();
  }

  /* --------------------------------------------------------------- stats -- */

  private renderStats() {
    const state = this.ctx.state;
    const s = state.stats;
    const d = state.derived;

    const xp = el('div', 'panel stat-card');
    xp.innerHTML = `
      <div class="card-head">Progression</div>
      <div class="stat-line"><span>Level</span><b>${s.level}</b></div>
      <div class="stat-line"><span>XP</span><b>${s.xp} / ${s.xpToNext}</b></div>
      <div class="bar bar-xp"><span class="bar-fill" style="width:${Math.min(100, (s.xp / s.xpToNext) * 100)}%"></span></div>
      <div class="stat-line"><span>Boss bar</span><b>${s.progress} / ${s.progressMax}</b></div>
      <div class="stat-line"><span>World cycle</span><b>${s.worldCycle + 1}</b></div>
      <div class="stat-line"><span>Battles won</span><b>${s.battlesWon}</b></div>
      <div class="stat-line"><span>Bosses felled</span><b>${s.bossesFelled}</b></div>
    `;
    this.panel.appendChild(xp);

    const rows: [string, string, string][] = [
      [STAT_ICONS.atk, 'Attack', String(d.atk)],
      [STAT_ICONS.def, 'Defense', String(d.def)],
      [STAT_ICONS.hp, 'Max HP', String(d.maxHp)],
      [STAT_ICONS.critChance, 'Crit Chance', formatStat('critChance', d.critChance)],
      [STAT_ICONS.critDamage, 'Crit Damage', `${Math.round(d.critDamage * 100)}%`],
      [STAT_ICONS.goldFind, 'Gold Find', `${Math.round(d.goldFind * 100)}%`],
      [STAT_ICONS.lifesteal, 'Lifesteal', formatStat('lifesteal', d.lifesteal)],
      [STAT_ICONS.speed, 'Speed', String(d.speed)]
    ];
    const grid = el('div', 'panel stat-card');
    grid.appendChild(el('div', 'card-head', `Combat power ✦ ${d.power}`));
    const body = el('div', 'stat-grid');
    for (const [icon, label, value] of rows) {
      body.appendChild(el('div', 'stat-cell', `<i>${icon}</i><span>${label}</span><b>${value}</b>`));
    }
    grid.appendChild(body);
    this.panel.appendChild(grid);

    const luck = activeLuckBonus();
    if (luck.dropsLeft > 0) {
      const card = el('div', 'panel stat-card');
      card.innerHTML = `<div class="card-head">🍀 Fortune active</div>
        <div class="stat-line"><span>Bonus luck</span><b>+${luck.bonus}</b></div>
        <div class="stat-line"><span>Drops remaining</span><b>${luck.dropsLeft}</b></div>`;
      this.panel.appendChild(card);
    }
  }

  /* ---------------------------------------------------------------- sets -- */

  private renderSets() {
    const state = this.ctx.state;
    const owned = new Set(state.stats.inventory.map(i => i.baseId));
    const worn = new Set(
      EQUIP_SLOTS.map(s => state.equipment[s]?.baseId).filter((v): v is string => Boolean(v))
    );

    const intro = el('div', 'panel set-intro');
    intro.innerHTML = `<b>Relic sets</b><span>Every set piece rolls one extra affix, so a set rare hits like an epic. Collect the four.</span>`;
    this.panel.appendChild(intro);

    for (const set of ITEM_SETS) {
      const pieces = setPieces(set.id);
      const have = pieces.filter(p => owned.has(p.id) || worn.has(p.id)).length;
      const equipped = pieces.filter(p => worn.has(p.id)).length;
      const card = el('div', `panel set-card${equipped > 0 ? ' is-active' : ''}`);
      card.innerHTML = `
        <div class="set-head">
          <span class="set-icon">${set.icon}</span>
          <span class="set-titles"><b>${set.name}</b><span>Lv ${set.level} · ${set.flavor}</span></span>
          <span class="set-count">${equipped}/${pieces.length}</span>
        </div>
        <div class="bar"><span class="bar-fill" style="width:${(have / pieces.length) * 100}%"></span></div>
        <div class="set-pieces">
          ${pieces
            .map(p => {
              const state2 = worn.has(p.id) ? 'is-worn' : owned.has(p.id) ? 'is-owned' : '';
              return `<span class="set-piece ${state2}"><i>${p.icon}</i>${p.name}</span>`;
            })
            .join('')}
        </div>
      `;
      this.panel.appendChild(card);
    }
  }

  /* --------------------------------------------------------- consumables -- */

  private renderConsumables() {
    const state = this.ctx.state;
    const owned = Object.entries(state.stats.consumables).filter(([, n]) => n > 0);

    if (owned.length === 0) {
      this.panel.appendChild(
        el('div', 'panel set-intro', `<b>No supplies</b><span>Potions and elixirs are sold in the shop.</span>`)
      );
      return;
    }

    const field = new Set(fieldConsumables().map(c => c.id));
    for (const [id, count] of owned) {
      const def = consumableById(id);
      if (!def) continue;
      const card = el('div', `panel cons-card tone-${def.tone}`);
      card.innerHTML = `
        <span class="cons-icon">${def.icon}</span>
        <span class="cons-body">
          <b>${def.name} <i class="cons-count">x${count}</i></b>
          <span>${def.description}</span>
          <span class="cons-where">${def.where === 'combat' ? 'Battle only' : def.where === 'field' ? 'Anywhere' : 'Anywhere'}</span>
        </span>
      `;
      const use = el('button', 'btn btn-primary btn-sm', 'Use');
      use.disabled = !field.has(id);
      use.addEventListener('click', () => this.useConsumable(id));
      card.appendChild(use);
      this.panel.appendChild(card);
    }
  }

  private useConsumable(id: string) {
    const def = consumableById(id);
    if (!def) return;
    const state = this.ctx.state;
    if (!state.useConsumable(id)) return;

    switch (def.effect.kind) {
      case 'healPct': {
        const before = state.stats.hp;
        state.heal(state.maxHp * def.effect.value);
        this.ctx.audio.play('heal');
        this.ctx.toast(`Restored ${state.stats.hp - before} HP`, 'good');
        break;
      }
      case 'healFlat': {
        state.heal(def.effect.value);
        this.ctx.audio.play('heal');
        this.ctx.toast(`Restored ${def.effect.value} HP`, 'good');
        break;
      }
      case 'xp': {
        const gain = Math.round(def.effect.value * (1 + state.stats.level * 0.35));
        const res = state.addXp(gain);
        this.ctx.audio.play(res.leveledUp ? 'levelup' : 'magic');
        this.ctx.toast(res.leveledUp ? `Level ${state.stats.level}!` : `+${gain} XP`, 'good');
        break;
      }
      case 'luck': {
        addLuckCharges(def.effect.value, 12);
        this.ctx.audio.play('magic');
        this.ctx.toast('Fortune smiles on your next drops', 'legendary');
        break;
      }
      default:
        this.ctx.toast('Save that one for a fight', 'info');
        state.addConsumable(id, 1);
        return;
    }
    this.ctx.save();
    this.renderDoll();
    this.renderConsumables();
  }

  /* ---------------------------------------------------------- item sheet -- */

  private openItem(item: ItemInstance, equipped: boolean) {
    const state = this.ctx.state;
    const current = state.equipment[item.slot];
    const body = itemDetail(item, equipped ? item : current);

    const actions = [];
    if (equipped) {
      actions.push({
        label: 'Unequip',
        kind: 'ghost' as const,
        disabled: state.bagFull,
        onClick: () => {
          if (!state.unequip(item.slot)) {
            this.ctx.toast('Bag is full', 'bad');
            return;
          }
          this.ctx.audio.play('ui_tap');
          this.afterChange();
        }
      });
    } else {
      const better = state.isUpgrade(item);
      actions.push({
        label: better ? '▲ Equip' : 'Equip',
        kind: 'primary' as const,
        onClick: () => {
          const res = state.equip(item);
          if (res.blocked) {
            this.ctx.toast('Bag is full — sell something first', 'bad');
            return;
          }
          this.ctx.audio.play('loot');
          this.ctx.toast(`Equipped ${item.name}`, better ? 'good' : 'info');
          this.afterChange();
        }
      });
      actions.push({
        label: `Sell ${state.sellValue(item)}g`,
        kind: 'gold' as const,
        onClick: () => {
          const gold = state.sellItem(item.uid);
          this.ctx.audio.play('coin');
          this.ctx.toast(`Sold for ${gold}g`, 'good');
          this.afterChange();
        }
      });
    }
    actions.push({ label: 'Close', kind: 'ghost' as const, onClick: () => this.closeSheet?.() });

    this.closeSheet?.();
    this.closeSheet = openSheet(this.root, body, actions);
  }

  private afterChange() {
    this.closeSheet?.();
    this.closeSheet = null;
    this.ctx.save();
    this.renderHeader();
    this.renderDoll();
    this.renderTabs();
    this.renderPanel();
  }
}

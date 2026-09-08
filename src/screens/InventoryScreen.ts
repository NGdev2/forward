import type { GameContext, InventoryParams, Screen, ScreenId, ScreenParams } from '../core/context';
import type { EquipSlot, ItemInstance, TalentKey } from '../game/types';
import { EQUIP_SLOTS, TALENT_KEYS } from '../game/types';
import { lookFromEquipment } from '../render/api';
import { STAT_ICONS, formatStat, formatStatSigned } from '../game/config';
import { TALENT_GAIN } from '../game/state';
import { addLuckCharges, activeLuckBonus } from '../game/loot';
import { ITEM_SETS, setPieces, wornSetCounts, type ItemSet } from '../game/data/items';
import { consumableById, fieldConsumables } from '../game/data/consumables';
import {
  SLOT_ICON,
  type SortMode,
  clear,
  el,
  elementBadge,
  esc,
  itemDetail,
  itemTile,
  openSheet,
  rarityClass,
  rarityVar,
  sortItems
} from './inventory/ui';
import {
  desc as cdesc,
  field as cfield,
  fmtNum,
  itemDisplayName,
  name as cname,
  setBonusLabel,
  slotLabel,
  statLabel,
  t,
  talentBlurb,
  talentName,
  tn
} from '../i18n';

type Tab = 'bag' | 'stats' | 'sets' | 'items';

/* Labels are looked up at render time so a language change applies on the next mount. */
const TABS: { id: Tab; key: string; icon: string }[] = [
  { id: 'bag', key: 'common.bag', icon: '🎒' },
  { id: 'stats', key: 'common.stats', icon: '📊' },
  { id: 'sets', key: 'common.sets', icon: '🏵️' },
  { id: 'items', key: 'common.items', icon: '🧪' }
];

const SORTS: { id: SortMode; key: string }[] = [
  { id: 'power', key: 'inventory.sort_power' },
  { id: 'rarity', key: 'inventory.sort_rarity' },
  { id: 'slot', key: 'inventory.sort_slot' },
  { id: 'recent', key: 'inventory.sort_recent' }
];

const BACK_KEY: Partial<Record<ScreenId, string>> = {
  run: 'inventory.back_road',
  shop: 'inventory.back_trader',
  reward: 'common.back'
};

const gold = (n: number) => t('common.gold_short', { n: fmtNum(n) });

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
  private from: ScreenId = 'run';
  private sort: SortMode = 'power';
  private filter: EquipSlot | 'all' = 'all';
  /** Which set cards are expanded on the Sets tab. Reset each visit. */
  private openSets = new Set<string>();
  private t = 0;

  mount(root: HTMLElement, ctx: GameContext, params: ScreenParams) {
    this.ctx = ctx;
    const p = params as InventoryParams;
    // Singleton screen: reset every per-visit field before anything reads it.
    this.tab = p.tab ?? 'bag';
    // "Back" must never land on the reward screen — remounting it would apply
    // the reward a second time. Anything else is a safe return target.
    this.from = p.from && p.from !== 'reward' && p.from !== 'inventory' ? p.from : 'run';
    this.filter = 'all';
    this.closeSheet = null;
    this.t = 0;
    this.openSets = new Set<string>();
    for (const [setId, worn] of wornSetCounts(ctx.state.equipment)) if (worn > 0) this.openSets.add(setId);

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
    back.setAttribute('aria-label', t(BACK_KEY[this.from] ?? 'common.back'));
    back.addEventListener('click', () => {
      this.ctx.audio.play('ui_back');
      this.ctx.goto(this.from);
    });
    this.headerHost.appendChild(back);

    const title = el('div', 'inv-title');
    title.innerHTML = `<b>${esc(t('common.level'))} ${s.level}</b><span>${esc(this.from === 'shop' ? t('inventory.at_trader') : t('inventory.cycle', { n: s.worldCycle + 1 }))}</span>`;
    this.headerHost.appendChild(title);

    const purse = el('div', 'inv-purse');
    purse.innerHTML = `
      <span class="chip chip-gold">🪙 ${fmtNum(s.gold)}</span>
      <span class="chip chip-gem">💎 ${s.gems}</span>
    `;
    this.headerHost.appendChild(purse);
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

    // Unspent level-up points are easy to forget; a chip on the doll makes
    // them visible from every tab and jumps to the Talents card.
    const points = this.ctx.state.stats.statPoints;
    if (points > 0) {
      const chip = el('button', 'chip chip-accent doll-points', `✦ ${esc(tn('inventory.points', points))}`);
      chip.setAttribute('aria-label', t('inventory.points_aria', { n: points }));
      chip.addEventListener('click', () => {
        this.ctx.audio.play('ui_tap');
        this.switchTab('stats');
      });
      centre.appendChild(chip);
    }

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
        <span class="ds-text">
          <span class="ds-slot">${esc(slotLabel(slot))}</span>
          <span class="ds-name">${esc(itemDisplayName(item))}</span>
        </span>
        <span class="ds-power">${item.power}</span>
      `;
    } else {
      btn.innerHTML = `
        <span class="ds-icon ds-empty">${SLOT_ICON[slot]}</span>
        <span class="ds-text">
          <span class="ds-slot">${esc(slotLabel(slot))}</span>
          <span class="ds-name ds-vacant">${esc(t('common.empty'))}</span>
        </span>
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
    body.appendChild(el('div', 'picker-head', `${SLOT_ICON[slot]} ${esc(slotLabel(slot))}`));
    if (options.length === 0) {
      body.appendChild(el('div', 'picker-empty', esc(t('inventory.slot_empty'))));
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
      { label: esc(t('common.close')), kind: 'ghost', onClick: () => this.closeSheet?.() }
    ]);
  }

  /* ---------------------------------------------------------------- tabs -- */

  private renderTabs() {
    clear(this.tabBar);
    const points = this.ctx.state.stats.statPoints;
    for (const tab of TABS) {
      const btn = el('button', `inv-tab${this.tab === tab.id ? ' is-active' : ''}`);
      const count =
        tab.id === 'bag'
          ? `<span class="tab-count">${this.ctx.state.bagCount}/${this.ctx.state.stats.inventoryCap}</span>`
          : '';
      const dot = tab.id === 'stats' && points > 0 ? `<span class="tab-dot" aria-label="${esc(tn('inventory.points', points))}"></span>` : '';
      btn.innerHTML = `<i>${tab.icon}</i><span>${esc(t(tab.key))}</span>${count}${dot}`;
      btn.addEventListener('click', () => {
        if (this.tab === tab.id) return;
        this.ctx.audio.play('ui_tap');
        this.switchTab(tab.id);
      });
      this.tabBar.appendChild(btn);
    }
  }

  private switchTab(tab: Tab) {
    this.tab = tab;
    this.renderTabs();
    this.renderPanel();
  }

  /**
   * The panel is always rebuilt from scratch. Every sub-renderer assumes an
   * empty host, which is what fixes the old "each filter tap appended another
   * bag grid" bug.
   */
  private renderPanel(keepScroll = false) {
    const scroll = this.panel.scrollTop;
    clear(this.panel);
    this.panel.scrollTop = keepScroll ? scroll : 0;
    if (this.tab === 'bag') this.renderBag();
    else if (this.tab === 'stats') this.renderStats();
    else if (this.tab === 'sets') this.renderSets();
    else this.renderConsumables();
    if (keepScroll) this.panel.scrollTop = scroll;
  }

  /* ----------------------------------------------------------------- bag -- */

  private renderBag() {
    const state = this.ctx.state;
    const tools = el('div', 'bag-tools');

    const sortRow = el('div', 'tool-row');
    sortRow.appendChild(el('span', 'tool-label', esc(t('inventory.sort'))));
    for (const s of SORTS) {
      const chip = el('button', `chip chip-tap${this.sort === s.id ? ' is-on' : ''}`, esc(t(s.key)));
      chip.addEventListener('click', () => {
        if (this.sort === s.id) return;
        this.sort = s.id;
        this.ctx.audio.play('ui_tap');
        this.renderPanel(true);
      });
      sortRow.appendChild(chip);
    }
    tools.appendChild(sortRow);

    const filterRow = el('div', 'tool-row tool-row-scroll');
    const mkFilter = (id: EquipSlot | 'all', label: string) => {
      const chip = el('button', `chip chip-tap${this.filter === id ? ' is-on' : ''}`, label);
      chip.setAttribute('aria-label', id === 'all' ? t('inventory.show_all') : t('inventory.show_slot', { slot: slotLabel(id) }));
      chip.addEventListener('click', () => {
        if (this.filter === id) return;
        this.filter = id;
        this.ctx.audio.play('ui_tap');
        this.renderPanel(true);
      });
      return chip;
    };
    filterRow.appendChild(mkFilter('all', esc(t('inventory.all'))));
    for (const slot of EQUIP_SLOTS) filterRow.appendChild(mkFilter(slot, SLOT_ICON[slot]));
    tools.appendChild(filterRow);
    this.panel.appendChild(tools);

    const junk = this.junkItems();
    const junkBar = el('div', 'bag-junk');
    const junkValue = junk.reduce((sum, i) => sum + state.sellValue(i), 0);
    junkBar.innerHTML = `<span>${esc(tn('inventory.junk', junk.length))}</span>`;
    const sellBtn = el('button', 'btn btn-gold btn-sm', esc(t('inventory.sell_all', { gold: gold(junkValue) })));
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
    if (this.filter === 'all') {
      const emptySlots = Math.max(0, state.stats.inventoryCap - state.bagCount);
      for (let i = 0; i < Math.min(emptySlots, 24); i++) grid.appendChild(el('div', 'bag-empty'));
    }
    if (items.length === 0) {
      const hint =
        this.filter === 'all'
          ? t('inventory.bag_empty')
          : t('inventory.no_slot_items', { slot: slotLabel(this.filter).toLowerCase() });
      grid.appendChild(el('div', 'bag-hint', esc(hint)));
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
    let earned = 0;
    for (const item of junk) earned += this.ctx.state.sellItem(item.uid);
    this.ctx.audio.play('coin');
    this.ctx.toast(t('inventory.sold_many', { n: junk.length, gold: gold(earned) }), 'good');
    this.ctx.save();
    this.renderHeader();
    this.renderTabs();
    this.renderPanel(true);
  }

  /* --------------------------------------------------------------- stats -- */

  private renderStats() {
    const state = this.ctx.state;
    const s = state.stats;
    const d = state.derived;

    this.panel.appendChild(this.talentCard());

    const rows: [string, string, string][] = [
      [STAT_ICONS.atk, statLabel('atk'), String(d.atk)],
      [STAT_ICONS.def, statLabel('def'), String(d.def)],
      [STAT_ICONS.hp, statLabel('hp'), String(d.maxHp)],
      [STAT_ICONS.critChance, statLabel('critChance'), formatStat('critChance', d.critChance)],
      [STAT_ICONS.critDamage, statLabel('critDamage'), `${Math.round(d.critDamage * 100)}%`],
      [STAT_ICONS.goldFind, statLabel('goldFind'), `${Math.round(d.goldFind * 100)}%`],
      [STAT_ICONS.lifesteal, statLabel('lifesteal'), formatStat('lifesteal', d.lifesteal)],
      [STAT_ICONS.speed, statLabel('speed'), String(d.speed)]
    ];
    const grid = el('div', 'panel stat-card');
    grid.appendChild(el('div', 'card-head', esc(t('inventory.combat_power', { n: d.power }))));
    const body = el('div', 'stat-grid');
    for (const [icon, label, value] of rows) {
      body.appendChild(el('div', 'stat-cell', `<i>${icon}</i><span>${esc(label)}</span><b>${value}</b>`));
    }
    grid.appendChild(body);
    this.panel.appendChild(grid);

    // Active set bonuses — what the worn relics are actually doing right now.
    const bonuses = state.setBonuses;
    const setCard = el('div', 'panel stat-card');
    setCard.appendChild(el('div', 'card-head', esc(t('inventory.set_bonuses'))));
    if (bonuses.length === 0) {
      setCard.appendChild(el('div', 'stat-note', esc(t('inventory.no_set_bonus'))));
    } else {
      for (const b of bonuses) {
        const line = el('div', 'set-bonus is-on');
        line.style.setProperty('--el', `var(--el-${b.set.element})`);
        line.style.setProperty('--el-soft', `var(--el-${b.set.element}-soft)`);
        line.innerHTML = `<b>${b.set.icon} ${esc(t('detail.pc', { n: b.bonus.pieces }))}</b><span><i>${esc(cname('set', b.set.id, b.set.name))}</i> ${esc(setBonusLabel(b.set.id, b.bonus.pieces, b.bonus.label))}</span>`;
        setCard.appendChild(line);
      }
    }
    this.panel.appendChild(setCard);

    const xp = el('div', 'panel stat-card');
    xp.innerHTML = `
      <div class="card-head">${esc(t('inventory.progression'))}</div>
      <div class="stat-line"><span>${esc(t('common.level'))}</span><b>${s.level}</b></div>
      <div class="stat-line"><span>${esc(t('common.xp'))}</span><b>${s.xp} / ${s.xpToNext}</b></div>
      <div class="bar bar-xp"><span class="bar-fill" style="width:${Math.min(100, (s.xp / s.xpToNext) * 100)}%"></span></div>
      <div class="stat-line"><span>${esc(t('inventory.boss_bar'))}</span><b>${s.progress} / ${s.progressMax}</b></div>
      <div class="stat-line"><span>${esc(t('inventory.world_cycle'))}</span><b>${s.worldCycle + 1}</b></div>
      <div class="stat-line"><span>${esc(t('stats.battles_won'))}</span><b>${s.battlesWon}</b></div>
      <div class="stat-line"><span>${esc(t('stats.bosses_felled'))}</span><b>${s.bossesFelled}</b></div>
    `;
    this.panel.appendChild(xp);

    const luck = activeLuckBonus();
    if (luck.dropsLeft > 0) {
      const card = el('div', 'panel stat-card');
      card.innerHTML = `<div class="card-head">${esc(t('inventory.fortune_active'))}</div>
        <div class="stat-line"><span>${esc(t('inventory.bonus_luck'))}</span><b>+${luck.bonus}</b></div>
        <div class="stat-line"><span>${esc(t('inventory.drops_left'))}</span><b>${luck.dropsLeft}</b></div>`;
      this.panel.appendChild(card);
    }
  }

  /** Unspent level-up points and the four permanent talents to sink them into. */
  private talentCard(): HTMLElement {
    const state = this.ctx.state;
    const points = state.stats.statPoints;
    const card = el('div', `panel stat-card talent-card${points > 0 ? ' has-points' : ''}`);

    const head = el('div', 'talent-head');
    head.innerHTML = `
      <span class="card-head">${esc(t('inventory.talents'))}</span>
      <span class="talent-points"><b>${points}</b><i>${esc(tn('inventory.to_spend', points))}</i></span>
    `;
    card.appendChild(head);

    for (const key of TALENT_KEYS) {
      const gain = TALENT_GAIN[key];
      const rank = state.stats.talents[key] ?? 0;
      const row = el('div', 'talent-row');
      row.innerHTML = `
        <i class="t-icon">${STAT_ICONS[gain.statKey]}</i>
        <span class="t-text">
          <b>${esc(talentName(key))}</b>
          <span>${esc(t('inventory.per_point', { gain: `${formatStatSigned(gain.statKey, gain.value)} ${statLabel(gain.statKey)}`, blurb: talentBlurb(key) }))}</span>
        </span>
        <span class="t-rank"><b>${rank}</b><i>${esc(t('inventory.rank'))}</i></span>
      `;
      const plus = el('button', 'btn btn-primary talent-plus', '+');
      plus.setAttribute('aria-label', t('inventory.spend_aria', { name: talentName(key) }));
      plus.disabled = points <= 0;
      plus.addEventListener('click', () => this.spendTalent(key));
      row.appendChild(plus);
      card.appendChild(row);
    }

    if (points === 0) {
      card.appendChild(el('div', 'stat-note', esc(t('inventory.every_level'))));
    }
    return card;
  }

  private spendTalent(key: TalentKey) {
    if (!this.ctx.state.spendTalent(key)) return;
    this.ctx.audio.play('levelup');
    this.ctx.save();
    this.renderDoll();
    this.renderTabs();
    this.renderPanel(true);
    const gain = TALENT_GAIN[key];
    this.ctx.toast(`${talentName(key)} — ${formatStatSigned(gain.statKey, gain.value)} ${statLabel(gain.statKey)}`, 'good');
  }

  /* ---------------------------------------------------------------- sets -- */

  private renderSets() {
    const state = this.ctx.state;
    const wornCounts = wornSetCounts(state.equipment);

    const intro = el('div', 'panel set-intro');
    intro.innerHTML = `<b>${esc(t('inventory.relic_sets'))}</b><span>${esc(t('inventory.relic_intro'))}</span>`;
    this.panel.appendChild(intro);

    for (const set of ITEM_SETS) {
      this.panel.appendChild(this.setCard(set, wornCounts.get(set.id) ?? 0));
    }
  }

  private setCard(set: ItemSet, worn: number): HTMLElement {
    const state = this.ctx.state;
    const pieces = setPieces(set.id);
    const isOpen = this.openSets.has(set.id);
    const card = el('div', `panel set-card${worn > 0 ? ' is-active' : ''}${isOpen ? ' is-open' : ''}`);
    card.style.setProperty('--el', `var(--el-${set.element})`);
    card.style.setProperty('--el-soft', `var(--el-${set.element}-soft)`);

    const head = el('button', 'set-head');
    head.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    head.innerHTML = `
      <span class="set-icon">${set.icon}</span>
      <span class="set-titles">
        <b>${esc(cname('set', set.id, set.name))}</b>
        <span>${esc(t('inventory.set_sub', { n: set.level, flavor: cfield('set', set.id, 'flavor', set.flavor) }))}</span>
      </span>
      <span class="set-meta">
        <span class="set-count">${worn}<i>/${pieces.length}</i></span>
      </span>
      <span class="set-chev" aria-hidden="true">▾</span>
    `;
    head.querySelector('.set-meta')!.prepend(elementBadge(set.element));
    head.addEventListener('click', () => {
      const open = !card.classList.contains('is-open');
      card.classList.toggle('is-open', open);
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) this.openSets.add(set.id);
      else this.openSets.delete(set.id);
      this.ctx.audio.play('ui_tap');
    });
    card.appendChild(head);

    const body = el('div', 'set-body');
    const inner = el('div', 'set-body-in');
    body.appendChild(inner);

    // Pieces: worn → tap opens the worn item; in bag → tap opens the best
    // copy; missing → inert.
    const list = el('div', 'set-pieces');
    for (const base of pieces) {
      const wornItem = state.equipment[base.slot]?.baseId === base.id ? state.equipment[base.slot] : null;
      const bagCopy = wornItem
        ? null
        : sortItems(state.stats.inventory.filter(i => i.baseId === base.id), 'power')[0] ?? null;
      const status = wornItem ? 'worn' : bagCopy ? 'owned' : 'missing';
      const row = el('button', `set-piece is-${status}`);
      const instance = wornItem ?? bagCopy;
      if (instance) row.style.setProperty('--rc', rarityVar(instance.rarity));
      row.innerHTML = `
        <i class="sp-icon">${base.icon}</i>
        <span class="sp-text">
          <b>${esc(instance ? itemDisplayName(instance) : cname('item', base.id, base.name))}</b>
          <span>${esc(slotLabel(base.slot))}${instance ? ` · ✦ ${instance.power}` : ''}</span>
        </span>
        <em class="sp-state">${esc(status === 'worn' ? t('inventory.worn') : status === 'owned' ? t('inventory.in_bag') : t('inventory.missing'))}</em>
      `;
      row.disabled = !instance;
      if (instance) {
        row.addEventListener('click', () => {
          this.ctx.audio.play('ui_tap');
          this.openItem(instance, Boolean(wornItem));
        });
      }
      list.appendChild(row);
    }
    inner.appendChild(list);

    const bonuses = el('div', 'set-bonuses');
    for (const b of set.bonuses) {
      const on = worn >= b.pieces;
      const line = el('div', `set-bonus${on ? ' is-on' : ''}`);
      line.innerHTML = `<b>${esc(t('detail.pc', { n: b.pieces }))}</b><span>${esc(setBonusLabel(set.id, b.pieces, b.label))}</span><em>${esc(on ? t('inventory.active') : t('inventory.more', { n: b.pieces - worn }))}</em>`;
      bonuses.appendChild(line);
    }
    inner.appendChild(bonuses);
    card.appendChild(body);
    return card;
  }

  /* --------------------------------------------------------- consumables -- */

  private renderConsumables() {
    const state = this.ctx.state;
    const owned = Object.entries(state.stats.consumables).filter(([, n]) => n > 0);

    if (owned.length === 0) {
      this.panel.appendChild(
        el(
          'div',
          'panel set-intro inv-empty',
          `<i>🧪</i><b>${esc(t('inventory.no_supplies'))}</b><span>${esc(t('inventory.no_supplies_note'))}</span>`
        )
      );
      return;
    }

    const field = new Set(fieldConsumables().map(c => c.id));
    for (const [id, count] of owned) {
      const def = consumableById(id);
      if (!def) continue;
      const card = el('div', `panel cons-card tone-${def.tone}`);
      card.style.setProperty('--rc', `var(--r-${def.tone})`);
      card.innerHTML = `
        <span class="cons-icon">${def.icon}</span>
        <span class="cons-body">
          <b>${esc(cname('consumable', def.id, def.name))} <i class="cons-count">x${count}</i></b>
          <span>${esc(cdesc('consumable', def.id, def.description))}</span>
          <span class="cons-where">${esc(def.where === 'combat' ? t('inventory.battle_only') : t('inventory.anywhere'))}</span>
        </span>
      `;
      const use = el('button', 'btn btn-primary btn-sm', esc(t('common.use')));
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
        this.ctx.toast(t('inventory.restored', { n: state.stats.hp - before }), 'good');
        break;
      }
      case 'healFlat': {
        state.heal(def.effect.value);
        this.ctx.audio.play('heal');
        this.ctx.toast(t('inventory.restored', { n: def.effect.value }), 'good');
        break;
      }
      case 'xp': {
        const gain = Math.round(def.effect.value * (1 + state.stats.level * 0.35));
        const res = state.addXp(gain);
        this.ctx.audio.play(res.leveledUp ? 'levelup' : 'magic');
        this.ctx.toast(res.leveledUp ? t('common.level_toast', { n: state.stats.level }) : t('inventory.xp_gain', { n: gain }), 'good');
        break;
      }
      case 'luck': {
        addLuckCharges(def.effect.value, 12);
        this.ctx.audio.play('magic');
        this.ctx.toast(t('inventory.fortune_toast'), 'legendary');
        break;
      }
      default:
        this.ctx.toast(t('inventory.save_for_fight'), 'info');
        state.addConsumable(id, 1);
        return;
    }
    this.ctx.save();
    this.renderHeader();
    this.renderDoll();
    this.renderTabs();
    this.renderPanel(true);
  }

  /* ---------------------------------------------------------- item sheet -- */

  private openItem(item: ItemInstance, equipped: boolean) {
    const state = this.ctx.state;
    const current = state.equipment[item.slot];
    const body = itemDetail(item, equipped ? item : current, state.equipment);

    const actions = [];
    if (equipped) {
      actions.push({
        label: esc(t('common.unequip')),
        kind: 'ghost' as const,
        disabled: state.bagFull,
        onClick: () => {
          if (!state.unequip(item.slot)) {
            this.ctx.toast(t('inventory.bag_full'), 'bad');
            return;
          }
          this.ctx.audio.play('ui_tap');
          this.afterChange();
        }
      });
    } else {
      const better = state.isUpgrade(item);
      actions.push({
        label: esc(better ? t('inventory.equip_up') : t('common.equip')),
        kind: 'primary' as const,
        onClick: () => {
          const res = state.equip(item);
          if (res.blocked) {
            this.ctx.toast(t('inventory.bag_full_sell'), 'bad');
            return;
          }
          this.ctx.audio.play('loot');
          this.ctx.toast(t('inventory.equipped_toast', { name: itemDisplayName(item) }), better ? 'good' : 'info');
          this.afterChange();
        }
      });
      actions.push({
        label: esc(t('inventory.sell_for', { gold: gold(state.sellValue(item)) })),
        kind: 'gold' as const,
        onClick: () => {
          const earned = state.sellItem(item.uid);
          this.ctx.audio.play('coin');
          this.ctx.toast(t('inventory.sold_for', { gold: gold(earned) }), 'good');
          this.afterChange();
        }
      });
    }
    actions.push({ label: esc(t('common.close')), kind: 'ghost' as const, onClick: () => this.closeSheet?.() });

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
    this.renderPanel(true);
  }
}

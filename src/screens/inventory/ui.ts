import type { EquipSlot, ItemInstance, Rarity, StatKey } from '../../game/types';
import { STAT_ICONS, STAT_LABELS, formatStat, formatStatSigned, rarityById } from '../../game/config';
import { compareItems, itemQuality } from '../../game/loot';
import { ABILITY_LABELS, setById } from '../../game/data/items';

/* ------------------------------------------------------------- dom utils -- */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function clear(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* ------------------------------------------------------------ item chrome -- */

export const SLOT_LABEL: Record<EquipSlot, string> = {
  weapon: 'Weapon',
  offhand: 'Offhand',
  helm: 'Helm',
  armor: 'Armor',
  boots: 'Boots',
  trinket: 'Trinket'
};

export const SLOT_ICON: Record<EquipSlot, string> = {
  weapon: '⚔️',
  offhand: '🛡️',
  helm: '🪖',
  armor: '🥋',
  boots: '🥾',
  trinket: '💍'
};

export function rarityClass(rarity: Rarity): string {
  return `rarity-${rarity}`;
}

export function rarityVar(rarity: Rarity): string {
  return `var(--r-${rarity})`;
}

export function statLine(key: StatKey, value: number, signed = false): string {
  const text = signed ? formatStatSigned(key, value) : formatStat(key, value);
  return `${STAT_ICONS[key]} ${text} ${STAT_LABELS[key]}`;
}

/** A bag / shop tile. */
export interface TileOpts {
  upgrade?: boolean;
  equipped?: boolean;
  badge?: string;
  price?: number;
  selected?: boolean;
  onClick?: (item: ItemInstance) => void;
}

export function itemTile(item: ItemInstance, opts: TileOpts = {}): HTMLButtonElement {
  const node = el('button', `item-tile ${rarityClass(item.rarity)}`);
  node.style.setProperty('--rc', rarityVar(item.rarity));
  if (opts.selected) node.classList.add('is-selected');
  if (opts.equipped) node.classList.add('is-equipped');
  node.innerHTML = `
    <span class="tile-glow"></span>
    <span class="tile-icon">${item.icon}</span>
    <span class="tile-power">${item.power}</span>
    ${opts.upgrade ? '<span class="tile-up">▲</span>' : ''}
    ${opts.equipped ? '<span class="tile-eq">E</span>' : ''}
    ${opts.badge ? `<span class="tile-badge">${opts.badge}</span>` : ''}
    ${opts.price !== undefined ? `<span class="tile-price">${opts.price}g</span>` : ''}
  `;
  node.setAttribute('aria-label', `${item.name}, ${item.rarity}, power ${item.power}`);
  if (opts.onClick) node.addEventListener('click', () => opts.onClick!(item));
  return node;
}

/* ------------------------------------------------------------ detail card -- */

export function itemDetail(item: ItemInstance, current: ItemInstance | null): HTMLElement {
  const tier = rarityById(item.rarity);
  const wrap = el('div', 'item-detail');
  wrap.style.setProperty('--rc', rarityVar(item.rarity));

  const head = el('div', 'detail-head');
  head.innerHTML = `
    <span class="detail-icon">${item.icon}</span>
    <span class="detail-titles">
      <span class="detail-name">${item.name}</span>
      <span class="detail-sub">${tier.label} · Lv ${item.ilvl} ${SLOT_LABEL[item.slot]}</span>
    </span>
    <span class="detail-power"><b>${item.power}</b><i>power</i></span>
  `;
  wrap.appendChild(head);

  // Roll quality
  const q = itemQuality(item);
  const quality = el('div', 'detail-quality');
  quality.innerHTML = `
    <span class="q-label">Roll quality</span>
    <span class="bar"><span class="bar-fill" style="width:${Math.round(q * 100)}%"></span></span>
    <span class="q-pct">${Math.round(q * 100)}%</span>
  `;
  wrap.appendChild(quality);

  const stats = el('div', 'detail-stats');
  stats.appendChild(statRow(item.primary.statKey, item.primary.value, true));
  for (const affix of item.affixes) stats.appendChild(statRow(affix.statKey, affix.value, false));
  wrap.appendChild(stats);

  if (item.abilityId) {
    const ability = el('div', 'detail-tag detail-ability');
    ability.innerHTML = `<b>✦ ${ABILITY_LABELS[item.abilityId] ?? item.abilityId}</b><span>Granted while equipped</span>`;
    wrap.appendChild(ability);
  }

  const set = setById(item.setId);
  if (set) {
    const tag = el('div', 'detail-tag detail-set');
    tag.innerHTML = `<b>${set.icon} ${set.name} relic</b><span>Rolls a bonus affix · ${set.flavor}</span>`;
    wrap.appendChild(tag);
  }

  wrap.appendChild(comparison(item, current));
  return wrap;
}

function statRow(key: StatKey, value: number, primary: boolean): HTMLElement {
  const row = el('div', `stat-row${primary ? ' is-primary' : ''}`);
  row.innerHTML = `
    <span class="s-icon">${STAT_ICONS[key]}</span>
    <span class="s-label">${STAT_LABELS[key]}</span>
    <span class="s-value">${primary ? '' : '+'}${formatStat(key, value)}</span>
  `;
  return row;
}

export function comparison(item: ItemInstance, current: ItemInstance | null): HTMLElement {
  const wrap = el('div', 'detail-compare');
  if (!current) {
    wrap.innerHTML = `<div class="cmp-head">Nothing equipped — pure gain</div>`;
  } else if (current.uid === item.uid) {
    wrap.innerHTML = `<div class="cmp-head">Currently equipped</div>`;
    return wrap;
  } else {
    wrap.innerHTML = `<div class="cmp-head">vs. equipped <b>${current.icon} ${current.name}</b></div>`;
  }

  const deltas = compareItems(item, current);
  const rows = el('div', 'cmp-rows');
  if (deltas.length === 0) {
    rows.appendChild(el('div', 'cmp-none', 'Identical stats.'));
  }
  for (const d of deltas) {
    const row = el('div', `cmp-row ${d.diff > 0 ? 'is-up' : 'is-down'}`);
    row.innerHTML = `
      <span class="s-icon">${STAT_ICONS[d.statKey]}</span>
      <span class="s-label">${STAT_LABELS[d.statKey]}</span>
      <span class="s-from">${formatStat(d.statKey, d.from)}</span>
      <span class="s-arrow">→</span>
      <span class="s-to">${formatStat(d.statKey, d.to)}</span>
      <span class="s-diff">${formatStatSigned(d.statKey, d.diff)}</span>
    `;
    rows.appendChild(row);
  }
  wrap.appendChild(rows);

  const diff = item.power - (current?.power ?? 0);
  const total = el('div', `cmp-total ${diff > 0 ? 'is-up' : diff < 0 ? 'is-down' : ''}`);
  total.innerHTML = `<span>Power</span><b>${diff >= 0 ? '+' : ''}${diff}</b>`;
  wrap.appendChild(total);
  return wrap;
}

/* --------------------------------------------------------------- sheet -- */

export interface SheetAction {
  label: string;
  kind?: 'primary' | 'ghost' | 'danger' | 'gold';
  disabled?: boolean;
  onClick: () => void;
}

/** Bottom-sheet modal. Returns a close() handle. */
export function openSheet(
  host: HTMLElement,
  content: HTMLElement,
  actions: SheetAction[]
): () => void {
  const scrim = el('div', 'sheet-scrim');
  const sheet = el('div', 'sheet');
  const body = el('div', 'sheet-body');
  body.appendChild(content);
  sheet.appendChild(el('div', 'sheet-grip'));
  sheet.appendChild(body);

  const bar = el('div', 'sheet-actions');
  for (const action of actions) {
    const btn = el('button', `btn btn-${action.kind ?? 'ghost'}`);
    btn.innerHTML = action.label;
    btn.disabled = Boolean(action.disabled);
    btn.addEventListener('click', () => action.onClick());
    bar.appendChild(btn);
  }
  sheet.appendChild(bar);
  scrim.appendChild(sheet);
  host.appendChild(scrim);

  requestAnimationFrame(() => scrim.classList.add('is-open'));

  const close = () => {
    scrim.classList.remove('is-open');
    window.setTimeout(() => scrim.remove(), 220);
  };
  scrim.addEventListener('click', e => {
    if (e.target === scrim) close();
  });
  return close;
}

/* -------------------------------------------------------------- sorting -- */

export type SortMode = 'power' | 'rarity' | 'slot' | 'recent';

const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

export function sortItems(items: ItemInstance[], mode: SortMode): ItemInstance[] {
  const list = [...items];
  switch (mode) {
    case 'power':
      return list.sort((a, b) => b.power - a.power);
    case 'rarity':
      return list.sort(
        (a, b) =>
          RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || b.power - a.power
      );
    case 'slot':
      return list.sort((a, b) => a.slot.localeCompare(b.slot) || b.power - a.power);
    default:
      return list.reverse();
  }
}

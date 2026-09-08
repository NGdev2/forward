/* ============================================================================
 * Builders for the shared component vocabulary in styles/components.css.
 * Using these keeps the markup structure (and therefore the CSS) consistent
 * across screens. Everything returns plain DOM — no state is retained except
 * inside the small controller objects returned by `bar()` and `sheet()`.
 * Owned by the design-system workstream; safe for any screen to import.
 * ========================================================================== */

import type { Rarity } from '../game/types';
import { el, cx } from './dom';
import { t } from '../i18n';

/* -------------------------------------------------------------------- bar -- */

export type BarKind = 'hp' | 'xp' | 'boss' | 'energy' | 'plain';

export interface BarOptions {
  kind?: BarKind;
  /** 'sm' 7px | default 12px | 'lg' 20px | 'xl' 26px */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Show the centred "value / max" caption. */
  label?: boolean;
  /** Adds the animated diagonal crawl over the fill. */
  flow?: boolean;
  className?: string;
}

export interface BarHandle {
  root: HTMLDivElement;
  /** Sets the fill from a value/max pair. The ghost trail follows on a delay. */
  set(value: number, max: number, text?: string): void;
  /** Sets the fill from a 0..1 ratio. */
  setRatio(ratio: number, text?: string): void;
}

const SIZE_CLASS: Record<string, string> = { sm: 'bar-sm', md: '', lg: 'bar-lg', xl: 'bar-xl' };

/**
 * Builds a track + ghost + fill (+ optional label) and returns a handle whose
 * `set()` drives the widths. The ghost keeps the previous width for a moment,
 * which is what produces the damage trail.
 */
export function bar(opts: BarOptions = {}): BarHandle {
  const kind = opts.kind ?? 'plain';
  const root = el('div', {
    class: cx('bar', kind !== 'plain' && `bar-${kind}`, SIZE_CLASS[opts.size ?? 'md'], opts.flow && 'bar-flow', opts.className)
  });
  const ghost = el('div', { class: 'bar-ghost' });
  const fill = el('div', { class: 'bar-fill' });
  root.append(ghost, fill);
  const label = opts.label ? el('span', { class: 'bar-label' }) : null;
  if (label) root.appendChild(label);

  let last = 0;
  const apply = (ratio: number, text?: string) => {
    const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * 100;
    // The ghost only lags on a decrease; on a gain it snaps ahead of the fill.
    ghost.style.width = `${Math.max(pct, pct > last ? pct : last)}%`;
    fill.style.width = `${pct}%`;
    last = pct;
    if (label && text !== undefined) label.textContent = text;
    root.classList.toggle('is-low', kind === 'hp' && pct <= 25);
    root.classList.toggle('is-full', kind === 'boss' && pct >= 100);
  };

  return {
    root,
    set(value, max, text) {
      apply(max > 0 ? value / max : 0, text ?? `${Math.round(value)} / ${Math.round(max)}`);
    },
    setRatio(ratio, text) {
      apply(ratio, text);
    }
  };
}

/** Segmented progress, e.g. the boss bar's discrete steps. */
export function pips(count: number, filled: number): HTMLDivElement {
  const root = el('div', { class: 'bar-pips' });
  for (let i = 0; i < count; i++) {
    root.appendChild(el('i', { class: i < filled ? 'is-on' : '' }));
  }
  return root;
}

/* ------------------------------------------------------------------ chips -- */

export type ChipTone = 'default' | 'accent' | 'gold' | 'gem' | 'good' | 'danger' | 'xp' | 'solid';

export function chip(text: string, tone: ChipTone = 'default', large = false): HTMLSpanElement {
  return el('span', { class: cx('chip', tone !== 'default' && `chip-${tone}`, large && 'chip-lg') }, text);
}

/** Danger level 1..5, colour-coded from safe green to pulsing red. */
export function dangerChip(level: number, text?: string): HTMLSpanElement {
  const lv = Math.max(1, Math.min(5, Math.round(level)));
  return el('span', { class: `chip chip-danger-${lv}` }, text ?? `${'◆'.repeat(lv)}`);
}

/* ---------------------------------------------------------------- buttons -- */

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'gold' | 'default';

export interface ButtonOptions {
  variant?: ButtonVariant;
  small?: boolean;
  large?: boolean;
  block?: boolean;
  /** Secondary line under the label, e.g. a price. */
  sub?: string;
  disabled?: boolean;
  className?: string;
  onClick?: (ev: MouseEvent) => void;
}

export function button(label: string, opts: ButtonOptions = {}): HTMLButtonElement {
  const node = el('button', {
    type: 'button',
    class: cx(
      'btn',
      opts.variant && opts.variant !== 'default' && `btn-${opts.variant}`,
      opts.small && 'btn-sm',
      opts.large && 'btn-lg',
      opts.block && 'btn-block',
      opts.sub && 'btn-stack',
      opts.className
    ),
    disabled: opts.disabled ?? false
  });
  node.appendChild(el('span', {}, label));
  if (opts.sub) node.appendChild(el('span', { class: 'btn-sub' }, opts.sub));
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  return node;
}

export function iconButton(glyph: string, label: string, onClick?: () => void): HTMLButtonElement {
  const node = el('button', { type: 'button', class: 'icon-btn', 'aria-label': label }, glyph);
  if (onClick) node.addEventListener('click', onClick);
  return node;
}

/* ----------------------------------------------------------------- panels -- */

export function panel(title: string | null, ...body: (Node | string)[]): HTMLDivElement {
  const root = el('div', { class: 'panel' });
  if (title) root.appendChild(el('div', { class: 'panel-hd' }, title));
  const bd = el('div', { class: 'panel-bd' });
  for (const child of body) bd.append(child);
  root.appendChild(bd);
  return root;
}

export function statRow(label: string, value: string | Node): HTMLDivElement {
  return el('div', { class: 'stat-row' }, el('span', {}, label), typeof value === 'string' ? el('span', {}, value) : value);
}

export function emptyState(icon: string, title: string, note?: string): HTMLDivElement {
  return el(
    'div',
    { class: 'empty' },
    el('div', { class: 'empty-icon' }, icon),
    el('div', { class: 'empty-title' }, title),
    note ? el('div', {}, note) : null
  );
}

/* ----------------------------------------------------------------- sheets -- */

export interface SheetOptions {
  title?: string;
  /** Centred dialog instead of a bottom sheet. */
  center?: boolean;
  /** Show an X in the header. Defaults to true. */
  closable?: boolean;
  /** Tapping the scrim closes it. Defaults to true. */
  dismissable?: boolean;
  onClose?: () => void;
}

export interface SheetHandle {
  root: HTMLDivElement;
  body: HTMLDivElement;
  foot: HTMLDivElement;
  open(): void;
  close(): void;
  /** Removes the sheet from the DOM after its close animation. */
  destroy(): void;
}

/**
 * Builds a bottom sheet (or centred dialog). It is appended to `host` hidden;
 * call `open()` on the next frame so the transition runs.
 */
export function sheet(host: HTMLElement, opts: SheetOptions = {}): SheetHandle {
  const scrim = el('div', { class: cx('sheet-scrim', opts.center && 'is-center') });
  const panelEl = el('div', { class: 'sheet' });
  const body = el('div', { class: 'sheet-bd' });
  const foot = el('div', { class: 'sheet-ft hidden' });

  if (opts.title || opts.closable !== false) {
    const hd = el('div', { class: 'sheet-hd' }, opts.title ?? '');
    if (opts.closable !== false) hd.appendChild(iconButton('✕', t('common.close'), () => handle.close()));
    panelEl.appendChild(hd);
  }
  panelEl.append(body, foot);
  scrim.appendChild(panelEl);
  host.appendChild(scrim);

  if (opts.dismissable !== false) {
    scrim.addEventListener('click', ev => {
      if (ev.target === scrim) handle.close();
    });
  }

  const handle: SheetHandle = {
    root: scrim,
    body,
    foot,
    open() {
      requestAnimationFrame(() => scrim.classList.add('is-open'));
    },
    close() {
      scrim.classList.remove('is-open');
      opts.onClose?.();
    },
    destroy() {
      scrim.classList.remove('is-open');
      window.setTimeout(() => scrim.remove(), 400);
    }
  };

  // Any footer content added later should reveal the strip.
  const observer = new MutationObserver(() => foot.classList.toggle('hidden', foot.childElementCount === 0));
  observer.observe(foot, { childList: true });

  return handle;
}

/* --------------------------------------------------------------- switches -- */

export function toggle(on: boolean, onChange: (next: boolean) => void, label?: string): HTMLButtonElement {
  const node = el('button', {
    type: 'button',
    class: 'switch',
    'aria-pressed': on ? 'true' : 'false',
    'aria-label': label ?? t('common.toggle')
  });
  node.appendChild(el('span', {}));
  node.addEventListener('click', () => {
    const next = node.getAttribute('aria-pressed') !== 'true';
    node.setAttribute('aria-pressed', next ? 'true' : 'false');
    onChange(next);
  });
  return node;
}

/* ---------------------------------------------------------------- slider -- */

export interface SliderOptions {
  min?: number;
  max?: number;
  step?: number;
  /** Accessible name. */
  label?: string;
  /** Formats the value caption; defaults to the integer. */
  format?: (v: number) => string;
  /** Fires on every move (drag). */
  onInput?: (v: number) => void;
  /** Fires once on release. */
  onChange?: (v: number) => void;
}

export interface SliderHandle {
  root: HTMLDivElement;
  input: HTMLInputElement;
  set(v: number): void;
  get value(): number;
}

/**
 * Range input styled with tokens: label on the left, live value on the right,
 * a filled track and a ≥28px thumb. The fill is driven by `--pct`.
 */
export function slider(title: string, value: number, opts: SliderOptions = {}): SliderHandle {
  const min = opts.min ?? 0;
  const max = opts.max ?? 100;
  const step = opts.step ?? 1;
  const fmt = opts.format ?? ((v: number) => String(Math.round(v)));

  const input = el('input', {
    type: 'range',
    class: 'slider-input',
    min,
    max,
    step,
    value,
    'aria-label': opts.label ?? title
  });
  const val = el('b', { class: 'slider-val num' }, fmt(value));
  const track = el('div', { class: 'slider-track' }, input);
  const root = el(
    'div',
    { class: 'slider' },
    el('div', { class: 'slider-hd' }, el('span', { class: 'slider-title' }, title), val),
    track
  );

  const paint = (v: number) => {
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    root.style.setProperty('--pct', `${pct}%`);
    val.textContent = fmt(v);
  };
  paint(value);

  input.addEventListener('input', () => {
    const v = Number(input.value);
    paint(v);
    opts.onInput?.(v);
  });
  input.addEventListener('change', () => opts.onChange?.(Number(input.value)));

  return {
    root,
    input,
    set(v) {
      input.value = String(v);
      paint(v);
    },
    get value() {
      return Number(input.value);
    }
  };
}

/* ------------------------------------------------------------- segmented -- */

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
}

/** Pill-style single choice control, e.g. language. */
export function segmented<T extends string>(
  options: SegmentedOption<T>[],
  active: T,
  onChange: (id: T) => void,
  label?: string
): HTMLDivElement {
  const root = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label ?? t('common.choose') });
  const buttons = new Map<T, HTMLButtonElement>();
  for (const o of options) {
    const b = el(
      'button',
      { type: 'button', class: cx('segmented-btn', o.id === active && 'is-active'), role: 'radio', 'aria-checked': o.id === active ? 'true' : 'false' },
      o.label
    );
    b.addEventListener('click', () => {
      if (b.classList.contains('is-active')) return;
      for (const [id, other] of buttons) {
        const on = id === o.id;
        other.classList.toggle('is-active', on);
        other.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      onChange(o.id);
    });
    buttons.set(o.id, b);
    root.appendChild(b);
  }
  return root;
}

/** Settings-style row: title, description and a control on the right. */
export function optionRow(title: string, desc: string, control: Node): HTMLDivElement {
  return el(
    'div',
    { class: 'opt-row' },
    el('div', { class: 'opt-text' }, el('div', { class: 'opt-title' }, title), el('div', { class: 'opt-desc' }, desc)),
    control
  );
}

/* ---------------------------------------------------------------- rarity -- */

export const RARITY_CLASS: Record<Rarity, string> = {
  common: 'rarity-common',
  uncommon: 'rarity-uncommon',
  rare: 'rarity-rare',
  epic: 'rarity-epic',
  legendary: 'rarity-legendary',
  mythic: 'rarity-mythic'
};

/** Item tile with the rarity border/aura treatment. Drop a canvas inside. */
export function tile(rarity: Rarity | null, content?: Node): HTMLDivElement {
  const node = el('div', {
    class: rarity ? cx('tile', 'tile-rarity', RARITY_CLASS[rarity]) : 'tile tile-empty'
  });
  if (content) node.appendChild(content);
  return node;
}

/* ---------------------------------------------------------------- topbar -- */

export function topbarStat(glyph: string, value: string, tone?: 'gold' | 'gem' | 'level'): HTMLDivElement {
  return el(
    'div',
    { class: cx('topbar-stat', tone && `topbar-stat-${tone}`) },
    el('i', {}, glyph),
    el('b', { class: 'num' }, value)
  );
}

/** Flashes a topbar stat to acknowledge a change. */
export function bumpStat(node: HTMLElement) {
  node.classList.remove('is-bumped');
  void node.offsetWidth;
  node.classList.add('is-bumped');
}

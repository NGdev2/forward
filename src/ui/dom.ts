/* ============================================================================
 * Tiny DOM helpers shared by every screen. No framework, no virtual DOM —
 * just enough sugar to keep screen code declarative.
 * Owned by the design-system workstream; safe for any screen to import.
 * ========================================================================== */

export type Attrs = Record<string, string | number | boolean | null | undefined>;
export type Child = Node | string | number | null | undefined | false;

/**
 * Creates an element.
 *   el('div', { class: 'panel' }, el('h2', {}, 'Title'), 'text')
 * `class`, `id`, `style` and `data-*` are set as attributes; anything starting
 * with `on` is bound as a listener.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(node, children);
  return node;
}

export function append(host: HTMLElement, children: Child[]) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    host.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

/** Joins class names, dropping falsy entries. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/** Query helper that throws instead of returning null, so typos fail loudly. */
export function q<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`[ui] missing element: ${selector}`);
  return found;
}

export function qa<T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

/**
 * Collects listeners so a screen's `unmount()` can release them all at once.
 *   const off = listeners();
 *   off.on(btn, 'click', fn);
 *   // unmount(): off.dispose();
 */
export function listeners() {
  const bound: (() => void)[] = [];
  return {
    on<T extends EventTarget>(target: T, type: string, handler: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions) {
      target.addEventListener(type, handler, opts);
      bound.push(() => target.removeEventListener(type, handler, opts));
    },
    dispose() {
      for (const fn of bound) fn();
      bound.length = 0;
    }
  };
}

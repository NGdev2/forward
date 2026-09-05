import type { GameContext, Screen, ScreenId, ScreenParams } from './context';

const TRANSITION_MS = 260;

/**
 * Owns the single RAF loop and the mount/unmount lifecycle so that screens
 * never have to manage their own animation frames (a common leak source).
 */
export class ScreenManager {
  private screens = new Map<ScreenId, Screen>();
  private active: Screen | null = null;
  private host: HTMLElement;
  private layer: HTMLElement;
  private ctx!: GameContext;
  private raf = 0;
  private last = 0;
  private navigating = false;

  constructor(host: HTMLElement) {
    this.host = host;
    this.layer = document.createElement('div');
    this.layer.className = 'screen-layer';
    this.host.appendChild(this.layer);
  }

  attachContext(ctx: GameContext) {
    this.ctx = ctx;
  }

  register(screen: Screen) {
    this.screens.set(screen.id, screen);
  }

  get currentId(): ScreenId | null {
    return this.active?.id ?? null;
  }

  async goto(id: ScreenId, params: ScreenParams = {}) {
    if (this.navigating) return;
    const next = this.screens.get(id);
    if (!next) {
      console.warn(`[screens] no screen registered for "${id}"`);
      return;
    }
    this.navigating = true;

    if (this.active) {
      this.layer.classList.add('is-leaving');
      await wait(TRANSITION_MS);
      this.active.unmount();
      this.layer.innerHTML = '';
      this.layer.classList.remove('is-leaving');
    }

    this.active = next;
    this.layer.dataset.screen = id;
    next.mount(this.layer, this.ctx, params);
    this.layer.classList.add('is-entering');
    requestAnimationFrame(() => this.layer.classList.remove('is-entering'));
    this.navigating = false;
  }

  start() {
    const loop = (t: number) => {
      if (!this.last) this.last = t;
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.active?.update?.(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

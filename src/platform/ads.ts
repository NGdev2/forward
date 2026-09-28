import { Capacitor } from '@capacitor/core';

/* ============================================================================
 * Rewarded ads.
 *
 * Screens only ever talk to `AdService`. Which provider runs depends on where
 * the game is running (see docs/ADS-PLAN.md):
 *
 *   browser + `npm run dev`   → MockAds: an in-game "test ad" overlay, no SDK
 *   browser, production build → NoAds: ad buttons are hidden
 *   Android app               → AdMobAds (ads.admob.ts). VITE_ADS_MODE=test
 *                               (default) uses Google's public test ad units;
 *                               VITE_ADS_MODE=live uses the real ids.
 *
 * The reward is granted ONLY when show() resolves 'rewarded' — never on the
 * button click, never when the ad is closed early.
 * ========================================================================== */

export type AdPlacement = 'double_reward' | 'revive' | 'free_gems';
export type AdOutcome = 'rewarded' | 'dismissed' | 'failed' | 'unavailable';

export interface AdHooks {
  /** Called when an ad takes over the screen — pause music and sound. */
  onOpen(): void;
  /** Called when the ad is gone — resume audio. */
  onClose(): void;
}

export interface AdService {
  /** False when no ads can ever show here (production web build): hide the buttons. */
  readonly available: boolean;
  /** Consent, SDK start-up and a first preload. Safe to call more than once. */
  init(): Promise<void>;
  /** Shows a rewarded ad. Resolves 'rewarded' only if the reward was earned. */
  show(placement: AdPlacement): Promise<AdOutcome>;
  /** True when the user must be offered a way to change their ad consent. */
  readonly privacyOptionsRequired: boolean;
  /** Re-opens the consent form (Settings → Privacy & ads). */
  showPrivacyOptions(): Promise<void>;
}

/** Google's public Android rewarded test unit. Safe to ship in debug builds only. */
export const TEST_REWARDED_ID = 'ca-app-pub-3940256099942544/5224354917';

export type AdsMode = 'test' | 'live';

export function adsMode(): AdsMode {
  return import.meta.env.VITE_ADS_MODE === 'live' ? 'live' : 'test';
}

/** Ad unit id per placement; test mode always uses Google's test unit. */
export function adUnitId(placement: AdPlacement): string {
  if (adsMode() === 'test') return TEST_REWARDED_ID;
  const env = import.meta.env;
  const id =
    placement === 'double_reward'
      ? env.VITE_ADMOB_REWARDED_DOUBLE
      : placement === 'revive'
        ? env.VITE_ADMOB_REWARDED_REVIVE
        : env.VITE_ADMOB_REWARDED_GEMS;
  return typeof id === 'string' && id.startsWith('ca-app-pub-') ? id : '';
}

/* ------------------------------------------------------------ providers -- */

class NoAds implements AdService {
  readonly available = false;
  readonly privacyOptionsRequired = false;
  async init() {}
  async show(): Promise<AdOutcome> {
    return 'unavailable';
  }
  async showPrivacyOptions() {}
}

/**
 * Local development stand-in: a short full-screen "test ad" drawn by the game.
 * Closing it before the countdown ends grants nothing, like a real ad.
 * Add `?ads=fail` to the URL to test the failure path.
 */
class MockAds implements AdService {
  readonly available = true;
  readonly privacyOptionsRequired = false;
  constructor(private hooks: AdHooks) {}
  async init() {}
  async showPrivacyOptions() {}

  show(placement: AdPlacement): Promise<AdOutcome> {
    if (new URLSearchParams(location.search).get('ads') === 'fail') return Promise.resolve('failed');
    return new Promise(resolve => {
      this.hooks.onOpen();
      const host = document.getElementById('game-root') ?? document.body;
      const el = document.createElement('div');
      el.className = 'mock-ad';
      el.innerHTML = `
        <button class="mock-ad-close" aria-label="Close">✕</button>
        <div class="mock-ad-body">
          <b>TEST AD</b>
          <span>${placement}</span>
          <em class="mock-ad-count">2</em>
          <u>Dev build — no real ad is shown</u>
        </div>`;
      host.appendChild(el);
      let left = 2;
      let earned = false;
      const count = el.querySelector('.mock-ad-count') as HTMLElement;
      const timer = window.setInterval(() => {
        left -= 1;
        if (left > 0) {
          count.textContent = String(left);
          return;
        }
        window.clearInterval(timer);
        earned = true;
        count.textContent = '✓';
        el.classList.add('is-done');
      }, 1000);
      (el.querySelector('.mock-ad-close') as HTMLElement).addEventListener('click', () => {
        window.clearInterval(timer);
        el.remove();
        this.hooks.onClose();
        resolve(earned ? 'rewarded' : 'dismissed');
      });
    });
  }
}

/* ------------------------------------------------------------- factory -- */

export function createAds(hooks: AdHooks): AdService {
  if (Capacitor.isNativePlatform()) return new LazyAdMob(hooks);
  if (import.meta.env.DEV) return new MockAds(hooks);
  return new NoAds();
}

/**
 * Loads the AdMob provider on first use so the web bundle never pulls the
 * native plugin's code path in.
 */
class LazyAdMob implements AdService {
  readonly available = true;
  private impl: AdService | null = null;
  private loading: Promise<AdService> | null = null;
  constructor(private hooks: AdHooks) {}

  private get(): Promise<AdService> {
    if (this.impl) return Promise.resolve(this.impl);
    this.loading ??= import('./ads.admob').then(m => (this.impl = new m.AdMobAds(this.hooks)));
    return this.loading;
  }
  get privacyOptionsRequired() {
    return this.impl?.privacyOptionsRequired ?? false;
  }
  async init() {
    await (await this.get()).init();
  }
  async show(placement: AdPlacement) {
    return (await this.get()).show(placement);
  }
  async showPrivacyOptions() {
    await (await this.get()).showPrivacyOptions();
  }
}

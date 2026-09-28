import {
  AdMob,
  AdmobConsentDebugGeography,
  AdmobConsentStatus,
  MaxAdContentRating,
  RewardAdPluginEvents
} from '@capacitor-community/admob';
import type { PluginListenerHandle } from '@capacitor/core';
import { adUnitId, adsMode, type AdHooks, type AdOutcome, type AdPlacement, type AdService } from './ads';

/* ============================================================================
 * Google AdMob rewarded ads (Android), via @capacitor-community/admob.
 *
 * Order matters and is required by Google:
 *   1. consent (UMP) — show the form when the user is in a region that needs it
 *   2. AdMob.initialize
 *   3. prepare → show rewarded ads
 * The plugin holds a single prepared rewarded ad at a time, so we keep one
 * preloaded (for the placement used most, the reward double) and load the
 * others on demand.
 * ========================================================================== */

export class AdMobAds implements AdService {
  readonly available = true;
  privacyOptionsRequired = false;

  private started: Promise<void> | null = null;
  private ready = false;
  private prepared: AdPlacement | null = null;
  private preparing: Promise<boolean> | null = null;
  private busy = false;

  constructor(private hooks: AdHooks) {}

  init(): Promise<void> {
    this.started ??= this.start().catch(err => {
      console.warn('[ads] start-up failed', err);
      this.started = null; // allow a retry on the next show()
    });
    return this.started;
  }

  private async start() {
    await this.gatherConsent();
    await AdMob.initialize({
      initializeForTesting: adsMode() === 'test',
      maxAdContentRating: MaxAdContentRating.Teen,
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
      testingDevices: testDevices()
    });
    this.ready = true;
    void this.prepare('double_reward');
  }

  private async gatherConsent() {
    try {
      // In test builds, VITE_ADMOB_DEBUG_EEA=true pretends the device is in the
      // EU so the consent form can be checked from anywhere.
      const forceEea = adsMode() === 'test' && import.meta.env.VITE_ADMOB_DEBUG_EEA === 'true';
      const info = await AdMob.requestConsentInfo({
        testDeviceIdentifiers: testDevices(),
        ...(forceEea ? { debugGeography: AdmobConsentDebugGeography.EEA } : {})
      });
      // Consent applies to this user (EEA/UK/CH or a US state message) once the
      // status is anything but NOT_REQUIRED — Google then requires a way to
      // change it later, which Settings offers.
      this.privacyOptionsRequired = info.status !== AdmobConsentStatus.NOT_REQUIRED;
      if (info.status === AdmobConsentStatus.REQUIRED && info.isConsentFormAvailable) {
        await AdMob.showConsentForm();
      }
    } catch (err) {
      // No consent message configured yet, or offline: ads still initialise and
      // AdMob serves limited/non-personalised ads where consent is missing.
      console.warn('[ads] consent', err);
    }
  }

  private prepare(placement: AdPlacement): Promise<boolean> {
    if (this.prepared === placement) return Promise.resolve(true);
    if (this.preparing) return this.preparing.then(() => this.prepare(placement));
    const adId = adUnitId(placement);
    if (!adId) return Promise.resolve(false);
    this.preparing = AdMob.prepareRewardVideoAd({ adId, isTesting: adsMode() === 'test' })
      .then(() => {
        this.prepared = placement;
        return true;
      })
      .catch(err => {
        console.warn('[ads] load failed', placement, err);
        this.prepared = null;
        return false;
      })
      .finally(() => {
        this.preparing = null;
      });
    return this.preparing;
  }

  async show(placement: AdPlacement): Promise<AdOutcome> {
    if (this.busy) return 'failed';
    this.busy = true;
    try {
      await this.init();
      if (!this.ready) return 'failed';
      if (!(await this.prepare(placement))) return 'failed';
      return await this.play();
    } finally {
      this.busy = false;
      // Keep the most-used placement warm for next time.
      void this.prepare('double_reward');
    }
  }

  private async play(): Promise<AdOutcome> {
    const handles: PluginListenerHandle[] = [];
    let rewarded = false;
    let settle: (o: AdOutcome) => void = () => {};
    const outcome = new Promise<AdOutcome>(resolve => (settle = resolve));
    // The outcome comes from the events: "rewarded" may fire before or after
    // the ad closes, and show() itself is not guaranteed to resolve when the
    // player closes the ad early.
    handles.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => (rewarded = true)));
    handles.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => settle(rewarded ? 'rewarded' : 'dismissed')));
    handles.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => settle(rewarded ? 'rewarded' : 'failed')));
    this.prepared = null; // a shown ad is spent
    this.hooks.onOpen();
    AdMob.showRewardVideoAd()
      .then(() => (rewarded = true))
      .catch(err => {
        console.warn('[ads] show failed', err);
        settle(rewarded ? 'rewarded' : 'failed');
      });
    try {
      return await outcome;
    } finally {
      this.hooks.onClose();
      for (const h of handles) void h.remove();
    }
  }

  async showPrivacyOptions() {
    try {
      await AdMob.resetConsentInfo();
      const info = await AdMob.requestConsentInfo({ testDeviceIdentifiers: testDevices() });
      if (info.isConsentFormAvailable) await AdMob.showConsentForm();
    } catch (err) {
      console.warn('[ads] privacy options', err);
    }
  }
}

/** Optional hashed device ids (from logcat) that must always get test ads. */
function testDevices(): string[] {
  const raw = import.meta.env.VITE_ADMOB_TEST_DEVICES;
  return typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'test' (default): Google's test ads. 'live': the real ad units below. */
  readonly VITE_ADS_MODE?: 'test' | 'live';
  readonly VITE_ADMOB_REWARDED_DOUBLE?: string;
  readonly VITE_ADMOB_REWARDED_REVIVE?: string;
  readonly VITE_ADMOB_REWARDED_GEMS?: string;
  /** Comma-separated hashed test device ids. */
  readonly VITE_ADMOB_TEST_DEVICES?: string;
  /** Test builds only: 'true' forces the EU consent form, for testing it. */
  readonly VITE_ADMOB_DEBUG_EEA?: string;
  /** 'true' shows gem packs and support tiers (needs Play Billing first). */
  readonly VITE_FEATURE_IAP?: string;
}

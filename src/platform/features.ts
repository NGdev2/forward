/**
 * Build-time feature flags, read from Vite env (`.env*` files).
 *
 * IAP surfaces (gem packs in the trader, support tiers on the title screen)
 * are kept in the code but hidden until Google Play Billing is wired up:
 * set VITE_FEATURE_IAP=true to show them again.
 */
export const FEATURES = {
  iap: import.meta.env.VITE_FEATURE_IAP === 'true'
};

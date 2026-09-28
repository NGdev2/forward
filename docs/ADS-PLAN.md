# Forward — Rewarded Ads (AdMob)

_Status: **implemented** in the code. What's left is your AdMob / Play Console setup (§3)
and a real-device test (§5). Updated 2026-09-28._

Only **rewarded, opt-in** ads: no banners, no interstitials. The store listing's
"no forced ads" stays true.

## 1. The three placements

| Placement | Where | Reward | Limit |
|---|---|---|---|
| **Double it** | Reward screen after fights, chests, coin caches | ×2 the gold and XP just earned | Once per reward screen (it's one button). No other limit. |
| **Second Wind** | Defeat panel in a fight | Back up at 60% HP (the enemy keeps its HP) | **3 per fight** ("2/3 left"), then the button disappears |
| **Free gems** | Trader → Gems tab | +10 💎 | None |

The reward is granted **only** when AdMob reports the ad was watched to the end. Closing it
early, a failed load or no internet grants nothing, and the button comes back (a short
"No ad available right now" toast on failure).

While an ad is on screen the game's music and sound effects are paused, then restored to
your own settings.

## 2. How it works in each build

| Where it runs | What you get |
|---|---|
| `npm run dev` in a browser | A **fake "TEST AD" screen** drawn by the game (2-second countdown, ✕ to close). No SDK, no network. Add `?ads=fail` to the URL to test the failure path. |
| Production web build (`npm run build`, browser) | No ads: the ad buttons are hidden. |
| Android **debug** APK (`npm run android:debug`) | **Real AdMob SDK with Google's test ads only.** Safe to tap. |
| Android **release** AAB (`npm run android:release`) | **Your real ads**, read from two git-ignored files. The release script refuses to build if they're missing or still contain test/placeholder ids. |

Code map:
- `src/platform/ads.ts` — the `AdService` interface, the dev mock, and provider selection.
- `src/platform/ads.admob.ts` — AdMob: consent → initialise → preload → show → events.
- `src/platform/features.ts` — `FEATURES.iap` (gem packs and support tiers, hidden for now).
- `android/app/build.gradle` + `AndroidManifest.xml` — AdMob **app id** per build type.
- `.env.example`, `android/admob.properties.example` — templates for your real ids.
- `scripts/android-release.sh` — `check_ads` guard.

## 3. What you need to set up

### In AdMob (admob.google.com)
1. **Add app** → Android → "not published yet" → name *Forward*. You get an **App ID**
   that looks like `ca-app-pub-1234567890123456~1234567890` (with a **~**).
2. **Create three Rewarded ad units** in that app (names are for you; suggested):
   `forward_double_reward`, `forward_revive`, `forward_free_gems`. Reward amount/type can
   stay at the defaults (the game decides the reward). Each gives an **Ad unit ID** like
   `ca-app-pub-1234567890123456/1234567890` (with a **/**).
3. **Privacy & messaging** → create and **publish** a **European regulations (GDPR)**
   message and a **US states** message for the app. The game shows it automatically on
   first launch where it applies, and Settings gets a "Privacy & ads" row.
4. **Payments** → fill in payment/tax info (needed before earnings pay out).

Privacy policy (for the GDPR message and Play): **https://forward-privacy-policy.vercel.app/**
5. Later, once the app is on Play: **link the AdMob app to the Play listing**
   (App settings → App store details).

### In this repo (two files, both git-ignored — never committed)
```bash
cp .env.example .env.production.local
cp android/admob.properties.example android/admob.properties
```
- `.env.production.local`: `VITE_ADS_MODE=live` and your three **ad unit** ids (`/`).
- `android/admob.properties`: `appId=` your **app** id (`~`).
- Optional: your phone's hashed test-device id in `VITE_ADMOB_TEST_DEVICES` (it appears in
  `adb logcat` as *"Use RequestConfiguration.Builder().setTestDeviceIds(…)"* the first
  time an ad loads). Your phone then always gets test ads, even in the release build.

Then `npm run android:release` builds a signed AAB with real ads (it prints
"Ads config OK" first). Keep backups of both files next to your keystore.

### app-ads.txt (AdMob asks for it)
AdMob shows you one line to publish at `https://<your-website>/app-ads.txt`, where the
website is the one listed on your Play store page. A GitHub Pages user site works:
repository `<username>.github.io` with an `app-ads.txt` at its root, and
`https://<username>.github.io` as the Play "Website". The same site can host the privacy
policy (`store/privacy-policy.md`, already updated for ads).

### In Play Console (when you create the listing)
- **App content → Ads:** *Yes, my app contains ads.*
- **Data safety:** *Device or other IDs* — collected and shared, for *Advertising or
  marketing*, by the Google Mobile Ads SDK; also declare what AdMob lists in its Data
  safety guidance (approximate location from IP, app interactions, diagnostics).
- **Advertising ID:** *Yes, used for advertising.* (The SDK adds the `AD_ID` permission.)
- **Target audience:** 13+ (not designed for children — the ads are configured for teens
  and not child-directed).
- **Privacy policy URL:** https://forward-privacy-policy.vercel.app/

## 4. Settings already chosen in code
- Max ad content rating **Teen**; not child-directed; not under age of consent.
- Consent (UMP) is requested **before** the SDK starts and before any ad request.
- The most-used ad (Double it) is preloaded at launch and after every ad; the others load
  on demand (the plugin holds one rewarded ad at a time), so a first tap may take a second
  or two — the button shows a loading state.

## 5. Testing checklist (debug APK on your phone)
- [ ] First launch shows the consent form where required. To see it from outside the EU,
      build the debug APK with `VITE_ADMOB_DEBUG_EEA=true` in `.env.development.local`
      (and your phone's id in `VITE_ADMOB_TEST_DEVICES`); reinstall to see it again.
- [ ] Each placement: test ad shows → reward granted once; close early → nothing.
- [ ] Airplane mode: tapping shows "No ad available right now", no crash, no reward.
- [ ] Music pauses during the ad and resumes after.
- [ ] Revive: works 3 times in one fight, then the button is gone.
- [ ] Then an **internal testing** release on Play with real ids and your phone registered
      as a test device. **Never tap real ads on your own phone** — AdMob can suspend the
      account for it.

## 6. Still to decide / do
- **Capacitor upgrade (recommended before the first Play upload).** Ads run on Capacitor 6
  with `@capacitor-community/admob@6.2`. Google Play raises the required Android target every
  year; Capacitor 8 (+ AdMob plugin 8.x) targets the current level out of the box. It needs
  **Node 22** on the build machine (this machine has Node 18). The upgrade is mechanical;
  the ad code doesn't change.
- **In-app purchases.** Gem packs (trader) and support tiers (title screen) are hidden, not
  removed. They need Google Play Billing; set `VITE_FEATURE_IAP=true` to show them again once
  purchases are wired.

# Forward — Rewarded Ads Plan

_Status: plan, not implemented. Written 2026-09-28 against commit `81fbfbd`._

Goal: the Android release shows **real rewarded ads** (Google AdMob) behind the three
"📺 Watch an ad" buttons that are placeholders today. Local development (`npm run dev` in a
browser) keeps working without any ad SDK, and debug Android builds only ever show Google's
test ads.

## 1. What exists today

| # | Placement | Where | What it grants now | Problem |
|---|---|---|---|---|
| 1 | **Double the reward** | `RewardScreen.double()`; offered when `RewardParams.allowDouble` (every won fight, coin caches, chests) | Doubles the gold and XP just earned | Granted on click, no ad. Once per reward screen (already guarded). |
| 2 | **Second Wind** (revive) | `CombatScreen.lose()` → `.cb-revive` | Hero back to 60% HP, enemy set to 50% of its current HP, fight resumes | Granted on click. **No limit** — you can die and revive repeatedly in the same fight. |
| 3 | **Free 10 gems** | `ShopScreen` Gems tab → `.shop-free` | `+10` gems | Granted on click. **No limit** — tappable endlessly. |

Not ads, but related and also placeholders: **gem packs** (Gems tab, `GEM_PACKS`) and
**support tiers** (title screen). Those need Google Play Billing, not AdMob — see §9.

The store listing promises _"no forced ads"_. This plan keeps that promise: **rewarded,
opt-in ads only — no banners, no interstitials.**

## 2. Decisions

1. **SDK:** Google AdMob via the Capacitor plugin `@capacitor-community/admob`.
2. **Format:** rewarded ads only (one ad unit per placement, so AdMob reports show which
   placement earns).
3. **Three environments:**

   | Environment | How it's detected | Ad provider |
   |---|---|---|
   | Browser, `npm run dev` | `!Capacitor.isNativePlatform()` and `import.meta.env.DEV` | **Mock**: a 2-second in-game "AD (dev)" overlay, then grants the reward. No SDK is loaded. |
   | Browser, production build | not native, not DEV | **Unavailable**: ad buttons are hidden. |
   | Android debug APK | native + `VITE_ADS_MODE=test` (default for debug) | **AdMob with Google's official test ad units**, `isTesting: true`. Never real ads. |
   | Android release AAB | native + `VITE_ADS_MODE=live` | **AdMob with the real ad units** from a local, git-ignored env file. |

4. **The reward is granted only on AdMob's "rewarded" callback**, never on the button click
   and never on "ad dismissed". Closing the ad early = no reward.
5. **Real AdMob ids stay out of the public repo.** They are not secret in the strict sense
   (they ship inside the APK), but publishing them lets anyone put your ad units in their own
   app and generate invalid traffic on your account. They live in `.env.production.local`
   and `android/admob.properties`, both already git-ignored.

## 3. Architecture

A small platform service, so screens never talk to the SDK directly:

```ts
// src/platform/ads.ts
export type AdPlacement = 'double_reward' | 'revive' | 'free_gems';
export type AdOutcome = 'rewarded' | 'dismissed' | 'failed' | 'unavailable';

export interface AdService {
  /** Consent + SDK init + preload. Safe to call more than once. */
  init(): Promise<void>;
  /** A loaded ad is ready for this placement and its cap isn't reached. */
  canShow(placement: AdPlacement): boolean;
  /** Shows the ad. Resolves 'rewarded' ONLY if the user earned the reward. */
  show(placement: AdPlacement): Promise<AdOutcome>;
  /** Re-opens the consent form (GDPR "privacy options" entry point). */
  showPrivacyOptions(): Promise<void>;
  readonly privacyOptionsRequired: boolean;
  onChange(cb: () => void): () => void; // availability changed → screens refresh buttons
}
```

- `src/platform/ads.mock.ts` — dev overlay, always rewards (a `?ads=fail` URL flag simulates
  failure so the error path can be tested locally too).
- `src/platform/ads.admob.ts` — the real implementation (dynamic `import()` so the web
  bundle never loads the plugin).
- `src/platform/ads.caps.ts` — per-placement limits and cooldowns, persisted in the save.
- `GameContext` gets `ads: AdService`; `main.ts` picks the provider from the table above.

**Button behaviour on every placement:**
- Not loaded yet → button shows a spinner and is disabled; never a dead click.
- Cap reached → button disabled with the reason ("Back tomorrow", "Once per fight").
- Offline / no fill → button hidden, or a toast "No ad available right now" if tapped.
- While the ad is on screen: **pause music and SFX** (`music.setEnabled(false)`, audio
  context suspended) and resume on dismiss. The music engine only auto-suspends on
  `visibilitychange`, which the native ad activity does not reliably trigger.
- After each show, **preload** the next ad for that placement.

## 4. Caps and economy (to fix before real ads go live)

| Placement | Cap | Reward | Notes |
|---|---|---|---|
| Double the reward | Once per reward screen (exists) + max **10 per hour** | ×2 gold and XP (unchanged) | Hourly cap avoids "farm ads instead of playing". Loot is not doubled (unchanged). |
| Second Wind | **Once per fight** | 60% HP, enemy at 50% (unchanged) | Second defeat in the same fight shows only "Limp back". Also rename the button to avoid clashing with the *Second Wind* combat ability — e.g. **"Rise again"**. |
| Free gems | **5 per day**, 3-minute cooldown between them | 10 gems each (= 200 gold at 20:1) | Counter resets at local midnight; shown as "3/5 today". |

Caps are stored in the save (`adCaps: { hourWindow, doublesThisHour, gemsToday, gemsDay, lastGemAt }`)
with defaults in `freshStats()` and fill-ins in `load()`.

## 5. Consent and privacy (required)

- **UMP consent (GDPR / UK / Switzerland, and US state privacy laws)** through the plugin's
  `requestConsentInfo()` → `showConsentForm()` **before** `initialize()` and the first ad
  request. Configure the GDPR and US-states messages in AdMob → *Privacy & messaging*.
- **Privacy options entry point:** a "Privacy & ads" row in Settings, shown when
  `privacyOptionsRequired` is true, that re-opens the consent form. Required by Google when
  consent applies.
- `maxAdContentRating: 'T'` (teen). `tagForChildDirectedTreatment: false`,
  `tagForUnderAgeOfConsent: false` — the game targets 13+; do **not** mark it as designed for
  children (that pulls in the Families policy and certified ad networks only).
- The `com.google.android.gms.permission.AD_ID` permission is added by the Google Mobile Ads
  SDK. Keep it, and answer "yes, uses advertising ID (for advertising)" in the Play Console.

## 6. Build configuration

- **Package:** `npm i @capacitor-community/admob` then `npx cap sync android`.
- **Version path (decide once):**
  - *Minimal:* stay on Capacitor 6 and use `@capacitor-community/admob@6.2.0` (peer
    `@capacitor/core ^6`). Works with Node 18 as installed today.
  - *Recommended:* first upgrade to **Capacitor 8** (`@capacitor/*@8.5`) and use
    `@capacitor-community/admob@8.1.0` (peer `@capacitor/core ^8`). Needs **Node 22** on the
    build machine. Reason: Google Play raises the required `targetSdkVersion` every August;
    Capacitor 8 targets the current level out of the box, Capacitor 6 does not. **Check the
    current requirement in Play Console → Policy status before the first upload.**
- **App id in the manifest** via a Gradle placeholder, so it's never hard-coded:
  ```xml
  <!-- android/app/src/main/AndroidManifest.xml, inside <application> -->
  <meta-data android:name="com.google.android.gms.ads.APPLICATION_ID"
             android:value="${admobAppId}"/>
  ```
  ```groovy
  // android/app/build.gradle — debug uses Google's public test app id,
  // release reads android/admob.properties (git-ignored)
  def admob = new Properties()
  def admobFile = rootProject.file('admob.properties')
  if (admobFile.exists()) admob.load(new FileInputStream(admobFile))
  buildTypes {
    debug   { manifestPlaceholders = [admobAppId: 'ca-app-pub-3940256099942544~3347511713'] }
    release { manifestPlaceholders = [admobAppId: admob['appId'] ?: 'MISSING_ADMOB_APP_ID'] }
  }
  ```
  The release build should **fail** if `admob.properties` is missing rather than ship a
  broken id — add a check in `scripts/android-release.sh`.
- **Ad unit ids** reach the web layer through Vite env files:
  ```bash
  # .env.example (committed)
  VITE_ADS_MODE=test
  VITE_ADMOB_REWARDED_DOUBLE=ca-app-pub-3940256099942544/5224354917
  VITE_ADMOB_REWARDED_REVIVE=ca-app-pub-3940256099942544/5224354917
  VITE_ADMOB_REWARDED_GEMS=ca-app-pub-3940256099942544/5224354917
  # .env.production.local (NOT committed) — real ids, VITE_ADS_MODE=live
  ```
  `ca-app-pub-3940256099942544/5224354917` is Google's public Android rewarded **test** unit.
- `android:debug` builds with `--mode development` (test ids); `android:release` builds with
  `--mode production` and refuses to run if `VITE_ADS_MODE` isn't `live` or any id still
  starts with `ca-app-pub-3940256099942544`.

## 7. Google-side setup (you do these in the consoles)

1. Create the app in **AdMob** (Android, not yet published → link it to Play later).
2. Create **three rewarded ad units**: `forward_double_reward`, `forward_revive`,
   `forward_free_gems`. Put their ids in `.env.production.local` and the app id in
   `android/admob.properties` (`appId=ca-app-pub-XXXX~YYYY`).
3. **Privacy & messaging:** publish a GDPR message and a US states message.
4. **app-ads.txt:** AdMob wants it at the root of the developer website listed on Play.
   A GitHub Pages user site works: `https://<user>.github.io/app-ads.txt` with the line
   AdMob gives you, and that URL's domain as the Play "Website". The same site can host the
   privacy policy (`store/privacy-policy.md`).
5. **Play Console:** App content → *Ads: contains ads = Yes*; *Data safety*: device or other
   IDs collected and shared for advertising (by AdMob), app activity/diagnostics as AdMob
   declares; *Target audience* 13+; *Advertising ID* declaration = used for ads.
6. Update `store/privacy-policy.md`: replace "no data collected / no network" with the AdMob
   section (advertising ID, consent, link to Google's policy), and update the store texts
   (still "no forced ads", now "optional rewarded ads").
7. Register your own phone as an **AdMob test device** before ever loading a real ad on it.
   Clicking your own live ads can get the AdMob account suspended.

## 8. Implementation steps

| Step | Work | Size |
|---|---|---|
| 0 | (Recommended) Upgrade Capacitor 6 → 8, Node 22, re-verify the debug build | ½ day |
| 1 | `AdService` interface, mock provider, `ctx.ads`, env/mode wiring | ½ day |
| 2 | Rewire the three placements to `await ctx.ads.show(...)`; button states; audio pause | ½ day |
| 3 | Caps + save migration + "3/5 today" UI; rename revive button; i18n EN/FR | ½ day |
| 4 | AdMob provider: consent → init → preload → show → events; Settings privacy row | 1 day |
| 5 | Gradle placeholders, env files, release-script guards | ½ day |
| 6 | Privacy policy, store texts, Play/AdMob console setup (§7) | ½ day |
| 7 | Testing (§10) | 1 day |

About five working days. Steps 1–3 are useful even before an AdMob account exists: they fix
the uncapped rewards and make the flow testable in the browser.

## 9. In-app purchases (separate track, not part of this plan)

Gem packs and support tiers need **Google Play Billing** (e.g. `@capgo/native-purchases` or
RevenueCat), products in Play Console, and server-less purchase verification decisions.
Until that exists, **hide both in release builds** behind a `VITE_FEATURE_IAP=false` flag —
visible purchase buttons that charge nothing are a policy risk at review.

## 10. Test plan

- **Browser (mock):** each placement grants exactly once; caps hold across reload; `?ads=fail`
  shows the failure toast and grants nothing; closing the mock early grants nothing.
- **Debug APK on a phone (test ads):** consent form appears on first launch from an EEA
  location (use UMP's debug geography setting); each placement loads, shows, rewards once;
  back button during the ad = no reward; airplane mode = button hidden/disabled, no crash;
  music pauses during the ad and resumes after; rapid double-tap shows one ad; app
  backgrounded mid-ad and resumed; revive refused on the second defeat of a fight.
- **Release build on the internal testing track (real ids, your phone registered as a test
  device):** ads fill, AdMob dashboard shows impressions per unit, no policy warnings.
- **Regression:** full run → fight → reward → shop loop with ads unavailable (web prod build)
  shows no dead buttons.

## 11. Open questions for you

1. Capacitor 8 upgrade before ads (recommended), or ship ads on Capacitor 6?
2. The cap numbers in §4 — keep, or tune after you play with them?
3. Do you already have an AdMob account and a developer website/domain for `app-ads.txt`,
   or should the plan assume GitHub Pages?

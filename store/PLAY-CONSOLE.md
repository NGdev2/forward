# Forward — Google Play Console setup

Exact answers for every Play Console screen, in order. Files referenced are in this repo.

| Thing | Value |
|---|---|
| App name | Forward (store title: `Forward: Endless Road RPG`) |
| Package | `com.aidar.forward` |
| Signed bundle | `android/app/build/outputs/bundle/release/app-release.aab` (v0.3.0, code 3) |
| Privacy policy | https://forward-privacy-policy.vercel.app/ |
| Contact email | aidar.devlab42@gmail.com |
| Website | https://forward-privacy-policy.vercel.app/ (needed later for `app-ads.txt`) |

## 1. Create app ✅
Name Forward · package com.aidar.forward · Game · Free · automatic protection on.

## 2. Store settings (Grow → Store presence → Store settings)
- **App category:** Game → **Role Playing**.
- **Tags** (pick up to 5 that Play offers): Role playing, Casual, Offline, Adventure, Single player.
- **Contact details:** email `aidar.devlab42@gmail.com`; website `https://forward-privacy-policy.vercel.app/`.

## 3. Main store listing (Grow → Store presence → Main store listing)
Default language English (United States):
- **App name:** `Forward: Endless Road RPG`
- **Short description / Full description:** copy from `store/listing-en.md`.
- **App icon:** `store/assets/store-icon-512.png`
- **Feature graphic:** `store/assets/feature-en.png`
- **Phone screenshots:** `store/screenshots/en/1-title.jpg` … `7-trader.jpg` (in that order).
- Tablet screenshots: optional; skip for now.

Then **Manage translations → Add your own translation text → French (fr-FR)**: switch the
listing to French, paste the texts from `store/listing-fr.md`, and add localised graphics:
feature graphic `store/assets/feature-fr.png`, screenshots `store/screenshots/fr/*.jpg`.

**Advanced settings → Form factors:** opt **out** of Google Play Games on PC (portrait touch
game; PC has its own layout/input requirements).

## 4. App content (Policy → App content)

**Privacy policy:** `https://forward-privacy-policy.vercel.app/`

**App access:** *All functionality in my app is available without any access restrictions.*

**Ads:** *Yes, my app contains ads.*

**Content rating** (IARC questionnaire): email `aidar.devlab42@gmail.com`, category **Game**.
- Violence: **Yes**. Tick **both** "violence against humans" (the Roadside Bandit enemy; the
  hero is human and gets hit) and "violence against anything other than humans".
  Setting **Fantastical**, reactions **Unrealistic**, pixelated/childlike **No**, presented
  **Often depicted from a close-up perspective** (every fight is a side-view duel), blood/gore
  **None** (the "Bleed" status is only an icon). Creatures behave like humans: **Yes**
  (goblins, orcs, skeletons wield weapons). Violence against real-world animals: **Yes**
  (rats, bats, crows, boars, wolves, spiders, a bear).
- Fear / horror: mild fantasy monsters (skeletons, wraiths) — answer **No** to intense horror.
- Sexuality, nudity, crude humour, profanity: **No**.
- Controlled substances: **No** (potions are fantasy healing items).
- Gambling: **No** real-money gambling and **no** simulated casino gambling (random loot is not
  gambling; nothing is bought with money).
- User interaction / chat / user-generated content: **No**. Shares location: **No**.
- Digital purchases: **No** (none in this version).
Expected result: roughly PEGI 7–12 / ESRB Everyone 10+ to Teen.

**Target audience and content:** age groups **13–15, 16–17, 18+** (not under 13).
*Could the app unintentionally appeal to children?* **No** — the ads are configured for teens
(`maxAdContentRating: Teen`, not child-directed), matching this answer.

**News app:** No. **Government app:** No. **Financial features:** None. **Health:** No.

**Advertising ID:** *Yes, my app uses advertising ID* → purpose **Advertising or marketing**
(and Analytics, Fraud prevention — as the Google Mobile Ads SDK declares).

**Data safety** — this is what the Google Mobile Ads SDK collects (the game itself collects
nothing; progress stays on the device):
- *Does your app collect or share any of the required user data types?* **Yes**.
- *Is all user data encrypted in transit?* **Yes**.
- *Do you provide a way for users to request that their data is deleted?* The app has no
  accounts; answer that users can't create an account (no account-deletion URL needed).
- Data types — for each: **Collected: Yes, Shared: Yes, Processed ephemerally: No,
  Required** (the SDK starts at launch), purposes **Advertising or marketing, Analytics,
  Fraud prevention, security and compliance**:
  - **Location → Approximate location** (derived from IP address)
  - **App activity → App interactions**
  - **App info and performance → Crash logs, Diagnostics**
  - **Device or other IDs → Device or other IDs** (advertising ID)

## 5. App signing
Keep **Google Play App Signing** (default). The key in `android/keystore/` is only your
*upload* key; Google holds the app signing key. Back up the upload key anyway.

## 6. Internal testing (fastest way to install the Play build on your phone)
Test and release → Testing → **Internal testing** → Create new release:
- Upload `app-release.aab`.
- Release name: `0.3.0 (3)`.
- Release notes:
  ```
  <en-US>
  First test build: endless road, three lanes, parry combat, relic sets, 20 bosses, EN/FR.
  </en-US>
  <fr-FR>
  Première version de test : route infinie, trois voies, parades, ensembles de reliques, 20 boss.
  </fr-FR>
  ```
- Testers tab: create an email list with your own Google account, save, copy the **opt-in
  link**, open it on your phone and install from Play.

Internal testing has no review and doesn't count toward the production requirement; it's for
checking the real Play build quickly. The first release of a new app can show "item not found"
for up to a few hours, and the app appears as "com.aidar.forward (unreviewed)" until the
listing's first review.

## 7. Closed testing (required before production for new personal accounts)
Test and release → Testing → **Closed testing** (e.g. the "Alpha" track) → add the same bundle
from the library (or upload a newer one), add **at least 12 testers** (email list or a Google Group) who must stay opted in for
**14 consecutive days**. Countries: all, or the ones you want.
Every new upload needs a higher `versionCode` (in `android/app/build.gradle`), then
`npm run android:release`.

## 8. Production
After the 14 days, Play Console unlocks **Apply for production access** (a short questionnaire
about the test). Then create the production release with the tested AAB.

## 9. After the app is live
1. **AdMob → Apps → Forward → App settings → Add app store details**, link the Play listing.
   This starts AdMob's app review, which lifts the ad-serving limit.
2. **app-ads.txt:** add a file named `app-ads.txt` at the root of the `Forward-privacy-policy`
   repo (it deploys to `https://forward-privacy-policy.vercel.app/app-ads.txt`) with the exact
   line AdMob shows under *Apps → app-ads.txt*. It has the form
   `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0`.
   The website in Play's Store settings must be `https://forward-privacy-policy.vercel.app/`.

# Forward

Forward is a mobile-first web game: a vertical "runner"-style game with combat encounters,
loot/loadout slots (weapon/armor/trinket), XP/leveling, and a shop screen. It's built with
Vite + TypeScript, plain DOM/CSS for the UI chrome, and a `<canvas>` for the game/road
rendering — no UI framework.

## Running locally

```bash
npm install
npm run dev
```

This starts the Vite dev server with hot reload.

## Building for the web

```bash
npm run build
```

Output goes to `dist/`. `npm run preview` serves that build locally if you want to sanity-check it.

## Wrapping as an Android app (Capacitor) and publishing to Google Play

The project already has Capacitor set up (`capacitor.config.ts`, `@capacitor/core`,
`@capacitor/cli`, `@capacitor/android`) and an `android/` native project has been scaffolded.
To actually build and ship it you need **Android Studio** installed locally (it bundles the
Android SDK, platform tools, and an emulator) — this container does not have the SDK, so the
native build itself has to happen on your machine.

Step by step:

1. **Scaffold the Android project** (already done once in this repo; only needed again if
   `android/` is ever deleted or you start fresh):
   ```bash
   npx cap add android
   ```

2. **Sync your web build into the native project** whenever you change web code:
   ```bash
   npm run cap:sync
   ```
   This runs `vite build` and then `npx cap sync android`, copying `dist/` into
   `android/app/src/main/assets/public` and updating native plugins.

3. **Open the project in Android Studio**:
   ```bash
   npm run cap:open
   ```
   Let Android Studio finish its Gradle sync (first time can take a while — it downloads the
   Gradle distribution and Android SDK components).

4. **Set a real application id.** `capacitor.config.ts` currently uses the placeholder
   `com.forward.runner` — pick a reverse-domain id you actually own (e.g.
   `com.yourcompany.forward`) and update both `capacitor.config.ts` and
   `android/app/build.gradle` (`applicationId`) before you release anything.

5. **Replace the placeholder app icon.** `public/icons/icon-192.png` and
   `public/icons/icon-512.png` are auto-generated placeholder art (a solid square with a
   glyph) referenced from `public/manifest.json` and `index.html`. Use Android Studio's
   Image Asset Studio (right-click `res` → New → Image Asset) to generate real adaptive
   icons from your own artwork before publishing.

6. **Create a signing keystore** (once per app, keep it safe — you need it for every future
   update):
   ```bash
   keytool -genkey -v -keystore forward-release.keystore -alias forward -keyalg RSA -keysize 2048 -validity 10000
   ```
   Configure signing in `android/app/build.gradle` (or via Android Studio's Build > Generate
   Signed Bundle/APK wizard).

7. **Build a signed Android App Bundle (AAB)**, either via Android Studio's
   Build > Generate Signed Bundle/APK, or from the command line:
   ```bash
   cd android
   ./gradlew bundleRelease
   ```
   The output `.aab` lands under `android/app/build/outputs/bundle/release/`.

8. **Upload to the Google Play Console.** Create an app entry, fill in the store listing
   (screenshots, description, content rating, privacy policy, etc.), upload the signed AAB
   to a testing or production track, and submit for review.

### Monetization note

The in-app shop and ad banner in this app are **placeholder UI only** — there's no real ad
SDK or billing integration wired up yet (see the "Real payments aren't connected yet" note
in the shop screen and the ad banner placeholder in `index.html`). Before this can actually
generate revenue you'll need to integrate a real ad SDK (e.g. Google AdMob) and Google Play
Billing for in-app purchases, then swap the placeholder buttons over to the real SDK calls.

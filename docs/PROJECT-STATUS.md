# Forward — Project Status & Roadmap

_Updated 2026-09-09 after feedback round 1 (`feedback.md`)._

## 1. What the game is

An endless-road RPG runner for phones (portrait, 390×844 reference). The hero runs down a road;
every few seconds three lanes open ahead (monster, elite, chest, coin cache, campfire, shrine,
trader, unknown). Picking a lane resolves it: fights go to a dedicated turn-based combat screen
with a timed parry; everything else lands on the reward screen. A road meter fills with every
encounter; when full the boss blocks the road (no lane choice). Beating the boss moves the
world to the next biome. The game is infinite, offline, and ships no image or audio assets.

**Stack:** Vite + TypeScript, plain DOM/CSS for UI, Canvas 2D for the world/fights, WebAudio for
SFX and music, Capacitor 6 for Android. No framework, no server, no analytics.

## 2. How to run and test

```bash
npm install
npm run dev -- --host      # desktop: open the local URL in a phone-sized responsive view
                           # phone: open the network URL over Wi-Fi
npm run build              # production bundle -> dist/
npx tsc --noEmit           # types
npm run sim                # combat balance simulator (scripts/BALANCE.md explains the model)
npm run i18n:check         # EN/FR completeness — must print "i18n check: OK"
```

- In DEV, `window.__game` is the `GameContext` (`state`, `goto('combat', {enemy})`, `save()`…)
  and, during a fight, `window.__combat` exposes `take(action)`, `simulateParry(offsetSec)`.
- Save lives in `localStorage['forward-save-v2']`; old saves migrate. Settings → Reset starts fresh.
- Automated QA was done with throwaway Playwright scripts (headless Chromium, not kept in the repo); the
  approach is: seed a save, drive `__game`/`__combat`, assert zero `pageerror`, screenshot.

## 3. Architecture in one page

| Area | Where | Rule |
|---|---|---|
| Screen routing | `src/core/screens.ts` | One RAF loop. Screens are singletons: reset every per-visit field in `mount()`. Never create your own `requestAnimationFrame`. |
| Context | `src/core/context.ts` | `{ state, sprites, fx, audio, music, goto, toast, save }` + typed screen params (`InventoryParams.from` = where Back returns). |
| Rewards | `src/screens/RewardScreen.ts` | The ONLY place gold/xp/loot/heal/boss progress are applied. Other screens describe earnings with `RewardParams`. |
| Combat engine | `src/game/combat.ts` | Two-phase round: `act(action)` → `'awaiting'` → `enemyTurn(parry)`. Resolution order and invariants are in the file header. |
| Content | `src/game/data/*` | Items (150 bases, 6 rarities, affixes), 6 sets with 2/4-piece bonuses + procs, 34 enemies (8 archetypes), 20 scripted bosses, abilities, consumables. |
| Balance | `scripts/sim.ts`, `scripts/BALANCE.md` | Every tuning knob is listed there with the measured results. |
| Rendering | `src/render/hero.ts`, `creatures.ts` | Parametric vector rigs; `sprites.ts` measures painted bounds; `fx.ts` particles + element trails. |
| Music | `src/render/music.ts` | Procedural step sequencer; modes title/run/combat/boss/shop/victory/defeat; `setIntensity`. |
| i18n | `src/i18n/` | `t()`, `tn()`, `fmtNum`; content names keyed by id (`name('enemy', id)`); `fr.ts` must cover every id (checked by `npm run i18n:check`). |
| Styling | `src/styles/tokens.css` | Screens use tokens, never hard-coded colours. |
| Persistence | `src/game/state.ts` | New persisted fields need a default in `freshStats()` AND a fill-in in `load()`. |

## 4. What was delivered in round 1 (all verified in headless Chromium, zero page errors)

**Combat**
- Perfect-timing parry (±110 ms around impact) → damage ×0.3, +1 energy, on-hit afflictions
  cancelled; shield raised / weapon cover pose; element FX per set on parry.
- Contact attacks (dash → hit on contact → recoil), projectiles for bow/staff/wand/chakram.
- Readable pacing: turn banner, per-beat holds, ghost HP bars, floating numbers 1.5 s.
- Player shield bar (Brace), 10 energy pips, statuses with tooltips.
- Full fight log (📜) grouped by round; visible on victory/defeat/escape panels.
- Death-order bugs fixed (no reflect on killing blow, enemy never acts after death, HP floors at 1 on a win).
- Energy economy tightened (start 3, +1 per Strike/round/parry/brace), abilities re-priced.
- Six set procs (Wolfpack first strike, Ironbound brace reflect, Ember burn, Tide parry heal, Void hunger, Dawn blessing).
- Revive (ad placeholder) no longer loops the death animation; boss loss resets the road to 0.
- Boss info sheet (passive + phases); fight summary on victory.

**Balance** — simulator with a realistic gear model (starting kit + best-of-N drops growing with level).
Level-1 normal fight ≈ 4 rounds / ~50% HP left without parrying; elites ~80% win; bosses 45–70%
win at average parry skill, all clearly winnable at good skill. XP curve: 3 fights/level at L1 → 13 at L40.

**Economy & inventory** — gold OR gems on any item (gems = ceil(gold/20), min 2); gem-only Relics
(set piece for your level, bag +6, fortune incense, potion bundle); Sell tab; trader only via the
road lane, with a bag round-trip; collapsible sets with bonuses; Talents (2 points per level:
Might/Guard/Vigor/Precision); scroll + filter bugs fixed.

**World** — 12 biomes (Greenway → Bloomvale → Sunsands → Mirewood → Frostmarch → Skyreach →
Stormcoast → Duskvale → Gloomfen → Ashfall → Emberdeep → Voidreach) with weather (rain, petals,
fireflies, ash, lightning); lane swerve eased with a lean; enemy weapons point at the hero;
hero guard/strike poses redone.

**Front of house** — new main screen (vista, hero with real gear, journey card, dock),
Statistics (kills, bosses, parries, damage, gold, most-hunted), Support tiers (placeholder),
Settings (EN/FR, music + SFX volume, reduced motion, auto-equip, reset). Dynamic music.
Complete French localisation (485 UI keys + ~770 content names).

**Packaging** — launcher icon + splash art, targetSdk 35, app id `com.aidar.forward`,
`scripts/android-release.sh` (keystore + signed AAB), `store/` listing texts EN/FR and a
privacy policy draft. A debug APK (6.2 MB) built successfully against SDK 35.

## 5. Known gaps and things to verify by hand

These are real; nobody has played the build on a physical phone yet.

- **Feel of the parry on a real touchscreen.** The ±110 ms window was tuned in a simulator. On a
  phone with touch latency it may need widening to ±140 ms (`PARRY_WINDOW` in `CombatScreen.ts`)
  or a small "early is forgiven" grace.
- **French at length.** The FR UI was verified with screenshots and the completeness check, not
  a long play session. Watch for overflow on small phones (long item names, shop buttons).
- **Small/large phones.** 360×740 and 430×932 layouts were only spot-checked (reward screen).
- **Late game.** The simulator says levels 25–40 are fair; no human has been there. Lifesteal +
  crit sustain makes late elites end with high HP (documented in BALANCE.md).
- **Ratking / beast bosses** read a little flat (angular "mane" shape). Art polish candidate.
- **Music mix** was checked for structure (modes, crossfades, intensity layers), not for taste.
  Volume defaults: music 0.6, SFX 0.8.
- **Rewarded ads are implemented** (AdMob; see `docs/ADS-PLAN.md`) but not yet tested on a
  real phone, and your real AdMob ids aren't configured yet. Gem packs and support tiers are
  hidden behind `VITE_FEATURE_IAP` until Play Billing exists.

## 6. Backlog — fix / upgrade / add / test

### Fix (small, worth doing before a wider test)
- [ ] Widen or add grace to the parry window after phone testing (see above).
- [ ] Live re-render on language change is title-only; other screens update on next mount. Fine
      in practice, but Settings opened from a non-title screen would show mixed language until
      navigation.
- [ ] `Second Wind` revive keeps enemy statuses; decide whether a revive should cleanse the player.
- [ ] Reward screen: with 3+ drops the loot list is long; consider collapsing non-upgrade drops.

### Upgrade (quality)
- [ ] Beast-body creature rigs (Ratking, wolf, boar, bear): add a proper mane/fur silhouette.
- [ ] Combat camera: subtle zoom on contact and on boss phase change.
- [ ] Run screen: the marker plates could show the enemy's archetype icon and threat colour.
- [ ] Haptics on Android (Capacitor Haptics plugin) for parry, hits, level-up.
- [ ] Music: a per-biome variation (key/instrument) so worlds sound different.

### Add (content & retention)
- [ ] Daily reward / login streak (gems + a potion), and a "daily boss" with a fixed seed.
- [ ] Achievements tied to the lifetime records already tracked (`kills`, `perfectParries`…).
- [ ] Bestiary screen from `killsById` (portrait, moves, best time-to-kill).
- [ ] Item crafting/upgrading (spend gold + a duplicate to raise an item's ilvl).
- [ ] More set pieces: every set currently lacks a weapon and armor piece; adding them lets set
      element FX come from the weapon itself.
- [ ] Prestige loop: after the 20th boss the roster loops at Rank 2 — add a visible "New Game+"
      moment with a permanent bonus.
- [ ] Cloud save (Play Games Services) once monetisation exists.

### Test (before Google Play)
- [ ] Play 30+ minutes on a real Android phone: parry feel, frame rate in Stormcoast/Emberdeep
      (heaviest biomes), audio unlock on first tap, back-button behaviour (Capacitor default
      closes the app on Android back — consider mapping it to the in-game Back).
- [ ] French full session on a phone.
- [ ] Old-save migration from a pre-round-1 save (a `forward-save-v2` blob from before 2026-09-08).
- [ ] Battery/thermal after 15 minutes (music scheduler + canvas at 60 fps).
- [ ] Closed test on Play (12 testers, 14 days) — required for new personal developer accounts.

## 6b. Round 2 (2026-09-28, from `feedback.md`)

- Bag starts at **40** slots (old saves raised to 40); traders sell **+5 slots, 2 per trader**,
  up to **200** total. Price 15 💎 rising by 4 💎 every 5 slots.
- Equipping is never blocked by a full bag (the old piece goes in, even one over the size).
  Drops that don't fit stay on the reward screen to wear or sell; leftovers are sold on leaving.
- Sell by rarity (trader Sell tab and bag), skipping upgrades; Epic+ asks for a second tap.
- Save self-repair: any stat that isn't a number (the NaN gems / bag bug) is reset to its
  default on load and before every save; spending functions refuse non-numbers.
- Title shows total **distance** travelled; distance is saved when leaving the road and when
  the app goes to the background (it used to be lost unless an encounter resolved).
- Rewarded ads wired to AdMob: double reward (no limit), free 10 💎 (no limit), Second Wind
  revive (3 per fight). Dev mock in the browser, test ads in debug APKs.
- App id is `com.aidar.forward`.

## 6c. Round 3 (2026-09-29): real-phone performance

Measured on a Realme 6 (Helio G90T, 1080×2400) through the debug build's WebView devtools:

| Screen | Before | After |
|---|---|---|
| Combat | 11 fps | 53–58 fps |
| Road (running) | 16 fps | 59 fps |
| Title | 47 fps | 57–59 fps |

- Main cause: the full-screen canvases weren't on their own compositor layer, so every canvas
  frame repainted all the blurred/shadowed UI on top (`will-change: transform` on the canvases).
- Characters render through a pose cache (`render/sprites.ts`); static scenery is painted once
  per size (arena background, road sky/sun/ground); marker glows and label plates are cached;
  vignette / boss pulse / impact flash on the road are CSS layers.
- Settings → Graphics: Auto / Balanced / High (`render/quality.ts`). Auto = Balanced (1.5×
  canvas, 20 fps pose steps) on touch devices, High (2.5×, 30) elsewhere.
- Parry ring closes in 0.9 s in all modes; reduced motion no longer shortens it, and floating
  texts stay readable (hold + fade) with reduced motion.
- Debug builds expose `window.__game`, `__combat`, `__run`, `__dev` for on-device measuring.

## 7. Android build setup

- Build machine: JDK 17 (`/usr/lib/jvm/java-17-openjdk-amd64`), Android SDK with platform 35
  (`ANDROID_HOME=~/Android/Sdk`), Node 18+ (Node 22 if Capacitor is upgraded, see ADS-PLAN).
- `android/` is committed (app id `com.aidar.forward`, SDK levels, icons, signing config).
  Build output, Gradle caches, `local.properties` and the web assets Capacitor copies in are
  git-ignored; so are keystores, `keystore.properties` and any `.env*` file.
- `npm run icons` re-renders launcher icons, splash screens, PWA icons and store graphics from
  `scripts/icons/icon.html`.
- `npm run android:debug` → debug APK; `npm run android:release` → signed AAB.

## 8. Release checklist (when you're ready)
1. Ads: finish the AdMob setup in `docs/ADS-PLAN.md` §3 (ids in `.env.production.local` and
   `android/admob.properties`, consent messages, app-ads.txt) and run its §5 checklist.
2. `./scripts/android-release.sh keystore` once (back up `android/keystore/` and
   `android/keystore.properties` somewhere safe — losing them means never updating the app).
3. Bump `versionCode`/`versionName` in `android/app/build.gradle`, then `npm run android:release`.
4. Host `store/privacy-policy.md` at a public URL; fill the Play listing from `store/listing-*.md`;
   icon 512×512 and feature graphic 1024×500 are in `store/assets/` (`npm run icons`); take real phone
   screenshots.
5. Content rating (fantasy violence), data safety (no data), closed test, production.

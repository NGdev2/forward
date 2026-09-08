# i18n — Forward

Tiny, framework-free localisation layer. No build step, no JSON loading: the
dictionaries are plain TypeScript maps bundled with the app (offline-safe).

## API (`src/i18n/index.ts`)

```ts
import { t, tn, fmtNum, setLanguage, getLanguage, onLanguageChange, LANGUAGES } from '../i18n';

t('title.continue')                         // "Continue the run"
t('settings.reset_body', { level: 4, bosses: 2 })
tn('title.bosses_felled', 3)                // picks `_one` / `_other`, fills {n}
fmtNum(12345)                               // "12,345" / "12 345"
setLanguage('fr')                           // persists nothing — caller saves settings.language
getLanguage()                               // 'en' | 'fr'
const off = onLanguageChange(lang => this.rerender()); // returns unsubscribe
LANGUAGES                                   // [{ id: 'en', native: 'English' }, { id: 'fr', native: 'Français' }]
```

Lookup order: current language → English → the key itself. A missing key never
throws; it shows up as `some.key` on screen so QA spots it.

`main.ts` calls `setLanguage(state.stats.settings.language)` before the first
screen mounts. The settings sheet on the title screen writes
`settings.language`, saves, and calls `setLanguage()`; screens that want to
re-render live subscribe with `onLanguageChange` in `mount()` and unsubscribe
in `unmount()`.

## Conventions

- **Keys are dotted and flat**: `<area>.<name>` — `common.back`, `stats.kills`,
  `combat.parry_perfect`. Snake_case names. One string per key; no nesting.
- **Areas**: `common` (shared vocabulary), `title`, `help`, `stats`, `support`,
  `settings`, then one per screen: `run`, `combat`, `reward`, `inventory`,
  `shop`, and `data` for item/enemy names if we ever localise content.
- **Interpolation** uses `{name}` placeholders: `'{n} gold'`, `'Level {level}'`.
  Pass numbers/strings via the params object. Never concatenate translated
  fragments in code (`t('a') + ' ' + t('b')`) — word order differs by language.
- **Plurals**: two keys, `<key>_one` and `<key>_other`, each containing `{n}`;
  call `tn(key, n)`. French uses `_one` for 0 and 1 in speech but the game
  reads fine with `_other` for 0, so keep it simple.
- **Numbers**: format with `fmtNum()` (thousands separators differ).
- **Reuse `common.*`** for Back/Close/Equip/Sell/Buy/Gold/Level/HP etc. rather
  than inventing per-screen duplicates.
- **English is the reference**: every key must exist in `en.ts`. `fr.ts` may
  lag; fallback covers it. When adding a key, add it to both files in the same
  section, in the same order.
- Typography: French uses a thin space before `?`, `!`, `:` — write it as a
  normal space (`« Tout effacer ? »`) for font safety.
- Keep strings free of markup. If a screen needs emphasis, split into two keys
  or wrap in code after translating.

## Adding a language

1. Add the code to `Language` in `src/game/types.ts` (`'en' | 'fr' | 'de'`).
2. Create `src/i18n/de.ts` exporting a `Dictionary`.
3. Register it in `DICTS` and `LANGUAGES` in `index.ts`.
4. The segmented control in the settings sheet renders from `LANGUAGES`.

## Key inventory

See `en.ts` — it is grouped by area with section comments and is the single
source of truth for which keys exist.

## Content (items, enemies, bosses…) — `src/i18n/content.ts`

Game content keeps its English text in the data tables (`src/game/data/*`,
`encounters.ts`, `run/biomes.ts`). Translations are keyed by the content's
**stable id**, never by its English text, and English needs no entry: when
the current language has no key, the data table's own field is used, so
nothing can render blank or as a bare key.

```ts
import { name, desc, field, itemDisplayName, moveLabel, statusName, phaseName,
         setBonusLabel, statLabel, slotLabel, rarityLabel, elementLabel } from '../i18n';

name('enemy', 'e_rat', base.name)              // "Rat d'égout" (fr) / base.name (en)
desc('ability', 'ab_rupture', ab.description)  // key `ability.ab_rupture.desc`
field('boss', 'b_ratking', 'title', base.title)
itemDisplayName(item)                          // "Dague féroce de l'Ours" — rebuilt from baseId + affixes
moveLabel('Crushing Slam')                     // enemy moves are keyed by English label (`move.<label>`)
phaseName('b_ratking', 1, phase.name)          // `boss.<id>.phase<index>.name` / `.banner`
setBonusLabel('set_wolf', 4, bonus.label)      // `set.<id>.bonus<pieces>`
```

Key shapes: `<kind>.<id>` (name), `<kind>.<id>.desc`, `<kind>.<id>.<field>`.
Kinds: `item`, `enemy`, `boss` (`.title`, `.flavor`, `.phaseN.name/banner`),
`ability`, `family` (weapon ability families), `status`, `set` (`.flavor`,
`.bonus2/4`), `consumable`, `encounter` (kind titles; `.desc` = subtitle),
`biome` (`.flavor`), `passive`, `archetype`, `elite` (elite prefixes),
`affix_prefix` / `affix_suffix` (per stat key), and the fixed enums `stat`,
`slot`, `rarity`, `element`, `talent` (these exist in BOTH en and fr).

Rules:
- Content is localised **at the source** where an instance is built:
  `pickEnemy` / `pickBoss` produce instances whose `name`/`title` are already
  in the current language; `encounters.ts` builds lane titles, subtitles,
  reward hints and tags with `t()`; the combat engine emits event `text` via
  `t()`. Screens never translate enemy names — they just print them.
- Item names: the saved `name` field is never touched. `itemDisplayName()`
  returns it verbatim in English and rebuilds it for other languages from
  `baseId` + ranked affixes using `data.affix_pattern` (word order) and the
  `affix_prefix.*` / `affix_suffix.*` tables. French adjectives are chosen
  gender-invariant and take an `s` when the base is flagged plural
  (`item.<id>.pl: '1'`).
- French register is **vous** / impersonal, matching the title screen.
- Adding content: add the id to the data table, then the French key(s) in
  `fr.ts`. The check script lists anything you forgot.

## Check

```
npx esbuild scripts/i18n-check.ts --bundle --platform=node --format=cjs \
  --log-level=warning --outfile=node_modules/.cache/forward-i18n-check.cjs \
&& node node_modules/.cache/forward-i18n-check.cjs
```

Reports EN keys missing in FR, literal `t('…')` / `tn('…')` keys used in
`src/` that are not in `en.ts`, and content ids (items, enemies, bosses,
phases, moves, abilities, statuses, sets, consumables, encounters, biomes,
passives, enums) without a French entry. All three lists must be empty.

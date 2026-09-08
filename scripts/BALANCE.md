# Combat balance — parameters and simulator results

Run `npm run sim` (300 fights per cell, ~2 min) or `npm run sim -- 100` for a quick pass.
`npm run sim -- 300 all bosses` prints one row per boss script at the level the road reaches it;
`npm run sim -- 1 all trace <bossIdx>` prints a single boss fight round by round;
`npm run sim -- 300 all xp` appends the XP-curve table.

The bot (scripts/sim.ts): best affordable ability off cooldown, else Strike; Brace when the
telegraphed hit is ≥ 35% of current HP (never more than twice in a row); potion below 35% HP
(2 minor potions below level 10, 1 greater potion after); parry succeeds with probability P.

**Gear model (realistic):** a fresh save wears the starting kit (Dagger, Leather Vest, Wooden
Buckler — equipped by `freshStats()`), and at level L the hero has seen `round(2 + 1.2·L)` loot
rolls (cap 30) at that level with their real `luck`; the best drop per slot replaces the kit only if
it is better, and slots that never dropped stay empty. Talents are spent evenly. Bosses are picked
at the cycle the boss bar actually reaches at that level (from the XP curve and
`PROGRESS_MAX_FOR_CYCLE`): L1 → Ratking, L8 → Morwen, L20 → Kaelen, L30 → The Timeless One,
L35+ → Rank 2 of the roster.

## Parameters settled on

| Knob | Value | Where |
|---|---|---|
| Starting kit | Dagger (atk 4), Leather Vest (def 3), Wooden Buckler (def 2) — worn from the first fight | `loot.ts` startingKit, `state.ts` freshStats |
| Energy | max 10, start 3, +1 Strike, +1/round, +1 perfect parry, +1 Brace, +2 Pass | `config.ts` COMBAT |
| Ability costs | Power Strike 4, Second Wind 5 (15% + Regen 2, cd 4), Rupture 4, Venom Strike 4, Flurry/Impale/Sunder/Ignite/Drain/Smite 5, Execute/Frostbind/Arcane Bolt/Whirlwind 6, Void Lance/Starfall 7, Bulwark/Purify 4, Battle Fury 5, Focus 0 (+3, cd 4) | `data/abilities.ts` |
| Brace | −50% on telegraphed hits, shield = 0.6·def(unbuffed) + 5% max HP, Fortify (1) capped at 2 stacks | `config.ts`, `combat.ts` |
| Perfect parry | every hit × 0.3 (min 1); brace + parry never below 20% of the raw hit; on-hit afflictions cancelled | `config.ts` parryMultiplier / parryFloor |
| Mitigation | damage × K/(K+def), K = 30 + 20·level (starting kit def 7 at L1 → 12% reduction; L20 ≈ 30%; L40 ≈ 45%) | `config.ts` mitBase / mitPerLevel |
| Status caps | Fortify 3, Enrage 4, Weaken 4, Regen 4, DoTs 12 | `combat.ts` STACK_CAP |
| DoT potency / stack / turn | Poison 6%, Burn 11%, Bleed 8% of source atk; Regen 2.8% of max HP | `combat.ts` statusPotency |
| Shields | decay ×0.5 per round | `combat.ts` tickStatuses |
| Level-up | +6 HP, +1 atk, +1 def, **2 talent points** (Might +2 atk, Guard +2 def, Vigor +12 HP, Precision +1.5% crit) | `state.ts` |
| Gear | rarity mult 1 / 1.15 / 1.32 / 1.5 / 1.72 / 2.0; primary grows 4%/ilvl; hp affix 1.2/ilvl, crit 0.0008, crit dmg 0.004, lifesteal 0.0004; speed weight 1 in the power score | `config.ts`, `loot.ts` |
| Normal enemy (level L) | HP 21 + 22L + 0.55L², ATK 5 + 2L + 0.12L², DEF 2 + 3L, ± creature flavour (60% of its tier deviation) × archetype traits | `data/enemies.ts` ENEMY_TUNING |
| Elite | HP ×(0.65 + 0.005L), ATK ×(1.5 + 0.01L), DEF ×1.2 (on top of +1 level), gold ×2.5, XP ×2.2, guaranteed rare+, one of lifesteal 20% / reflect 20% / enrage (1, +2 below half) | `data/enemies.ts` |
| Boss | HP ×(1.5 + 0.005L), ATK ×(1.2 + 0.01L), DEF ×1.5 of the level nominal, × per-boss hpMult/atkMult (0.7–1.4), +10% per roster loop; anti-stall +5% atk/round from round 20 | `data/bosses.ts` BOSS_TUNING, `config.ts` bossEnrageTurn |
| Boss passives | Thorns 15%, Siphon 15%, Relentless +2%/turn, Adaptive ≤3 Fortify, Hoarfrost ≤3 Weaken, Devour only on heals ≥5% max HP (≤3), Rewind to 55% | `combat.ts` |
| Rewards | XP 6 + 2.4L + 0.06L² per normal fight; gold 5 + 2.5L + 0.04L²; boss ×5 (× goldMult/xpMult) | `data/enemies.ts` |
| XP curve | (3 + 0.25L) fights per level → 3 fights at L1, 5.5 at L10, 8 at L20 (112 fights cumulative), 13 at L40 (325) | `config.ts` XP_CURVE |

## The opening (fresh save, browser-verified)

A fresh save (40 HP, atk 10, def 7 with the kit) against `pickEnemy(1, false)` using **only Strike
and no parry** (no skills, no brace, no potions), 20 fights in headless Chromium through
`/src/game/combat.ts`: **18/20 wins, 21% HP left, 5.4 rounds**; `threat()` reads Even 75% /
Favourable 25%. With the bot's skills, brace and parries (table below) the same fights take 3.8
rounds and end at 75% HP.

## Results (300 fights per cell)

Targets at P = 0.35: L1 normal 3–4 rounds / 65–80% HP / win ≥ 97%, L1 elite 65–80%, Ratking 55–65%;
elsewhere normal 3–5 rounds / 65–85% HP; elite 5–8 rounds / 40–65% HP / win 80–90%; boss 8–14 rounds /
win 45–65%, clearly winnable at P = 0.7.

### P = 0.35 (average player)

| level | type | win | rounds | hp left | energy | skills | potions | threat read |
|---|---|---|---|---|---|---|---|---|
| 1 | normal | 100% | 3.8 | 75% | 7.3 | 1.8 | 0.01 | Favourable 58%, Even 36%, Trivial 5% |
| 1 | elite | 79% | 7.8 | 60% | 13.9 | 3.3 | 0.52 | Even 63%, Dangerous 30%, Deadly 7% |
| 1 | boss (Ratking) | 60% | 7.7 | 53% | 13.9 | 3.2 | 1.02 | Dangerous 100% |
| 3 | normal | 100% | 4.4 | 76% | 8.2 | 2.0 | 0.03 | Favourable 64%, Even 27%, Trivial 9% |
| 3 | elite | 90% | 8.0 | 63% | 15.3 | 3.7 | 0.40 | Even 81%, Dangerous 15%, Deadly 4% |
| 3 | boss (Grubnash) | 71% | 9.0 | 59% | 18.0 | 4.3 | 0.73 | Dangerous 79%, Deadly 21% |
| 5 | normal | 100% | 4.4 | 73% | 8.9 | 2.1 | 0.03 | Favourable 47%, Even 41%, Trivial 9% |
| 5 | elite | 86% | 7.0 | 62% | 14.0 | 3.2 | 0.45 | Even 81%, Dangerous 15%, Deadly 5% |
| 5 | boss (Fenrik) | 64% | 9.8 | 53% | 21.3 | 4.9 | 0.91 | Dangerous 84%, Deadly 16% |
| 8 | normal | 99% | 5.0 | 70% | 10.1 | 2.4 | 0.06 | Even 55%, Favourable 32%, Dangerous 8% |
| 8 | elite | 80% | 7.3 | 64% | 19.2 | 4.5 | 0.49 | Even 70%, Dangerous 19%, Deadly 10% |
| 8 | boss (Morwen) | 60% | 17.1 | 64% | 41.7 | 9.9 | 0.88 | Dangerous 55%, Deadly 45% |
| 12 | normal | 100% | 4.9 | 73% | 10.0 | 2.5 | 0.02 | Even 62%, Favourable 28%, Dangerous 8% |
| 12 | elite | 90% | 8.6 | 71% | 19.9 | 4.9 | 0.21 | Even 57%, Dangerous 28%, Deadly 15% |
| 12 | boss (Skarrix) | 74% | 11.4 | 62% | 25.5 | 6.3 | 0.59 | Dangerous 84%, Deadly 16% |
| 16 | normal | 100% | 5.4 | 73% | 11.7 | 3.3 | 0.03 | Even 66%, Favourable 14%, Dangerous 12% |
| 16 | elite | 87% | 9.0 | 70% | 20.0 | 5.1 | 0.30 | Even 58%, Dangerous 26%, Deadly 16% |
| 16 | boss (Nyxareth) | 63% | 19.1 | 66% | 41.2 | 10.8 | 0.58 | Deadly 80%, Dangerous 20% |
| 20 | normal | 100% | 4.8 | 79% | 10.6 | 2.9 | 0.04 | Even 57%, Favourable 24%, Dangerous 12% |
| 20 | elite | 91% | 7.5 | 74% | 16.8 | 4.4 | 0.22 | Even 67%, Dangerous 19%, Deadly 14% |
| 20 | boss (Kaelen) | 54% | 9.5 | 72% | 20.3 | 5.3 | 0.45 | Dangerous 70%, Deadly 30% |
| 25 | normal | 100% | 4.8 | 80% | 10.1 | 2.5 | 0.01 | Even 58%, Favourable 22%, Trivial 10% |
| 25 | elite | 92% | 8.1 | 78% | 19.1 | 4.7 | 0.11 | Even 49%, Dangerous 29%, Deadly 22% |
| 25 | boss (Karn) | 63% | 13.4 | 71% | 29.1 | 7.1 | 0.59 | Deadly 57%, Dangerous 43% |
| 30 | normal | 100% | 5.6 | 79% | 12.0 | 3.3 | 0.02 | Even 56%, Favourable 18%, Dangerous 14% |
| 30 | elite | 94% | 10.9 | 76% | 25.0 | 6.5 | 0.13 | Even 40%, Dangerous 35%, Deadly 25% |
| 30 | boss (Timeless One) | 44% | 19.4 | 75% | 44.3 | 11.4 | 0.48 | Deadly 79%, Dangerous 21% |
| 35 | normal | 100% | 4.3 | 87% | 9.2 | 2.6 | 0.01 | Even 50%, Favourable 27%, Trivial 11% |
| 35 | elite | 82% | 8.7 | 80% | 22.7 | 6.1 | 0.22 | Even 48%, Deadly 27%, Dangerous 25% |
| 35 | boss (Fenrik, Rank 2) | 22% | 11.8 | 71% | 34.1 | 8.6 | 0.70 | Deadly 93%, Dangerous 7% |
| 40 | normal | 100% | 5.0 | 82% | 10.2 | 2.7 | 0.02 | Even 52%, Dangerous 26%, Favourable 12% |
| 40 | elite | 87% | 7.8 | 84% | 17.9 | 4.5 | 0.13 | Deadly 53%, Dangerous 27%, Even 21% |
| 40 | boss (Gravemaw, Rank 2) | 54% | 14.8 | 71% | 34.5 | 8.6 | 0.59 | Deadly 100% |

### P = 0.7 (good player)

| level | normal win / rounds / hp | elite win / rounds / hp | boss win / rounds / hp |
|---|---|---|---|
| 1 | 100% / 3.6 / 84% | 94% / 6.3 / 72% | 92% / 6.9 / 62% |
| 3 | 100% / 4.1 / 85% | 97% / 6.1 / 73% | 95% / 8.7 / 69% |
| 5 | 100% / 3.8 / 84% | 98% / 5.2 / 75% | 89% / 9.1 / 64% |
| 8 | 100% / 4.5 / 82% | 94% / 6.3 / 74% | 90% / 14.7 / 72% |
| 12 | 100% / 4.4 / 83% | 98% / 6.6 / 78% | 96% / 9.5 / 73% |
| 16 | 100% / 4.8 / 81% | 98% / 7.3 / 79% | 87% / 18.9 / 72% |
| 20 | 100% / 4.3 / 87% | 99% / 6.1 / 83% | 92% / 8.9 / 77% |
| 25 | 100% / 4.3 / 89% | 97% / 6.4 / 84% | 92% / 11.3 / 81% |
| 30 | 100% / 5.0 / 88% | 98% / 8.9 / 83% | 77% / 20.6 / 84% |
| 35 | 100% / 4.0 / 93% | 93% / 7.2 / 87% | 59% / 13.7 / 79% |
| 40 | 100% / 4.3 / 91% | 95% / 7.4 / 92% | 87% / 15.3 / 79% |

### Every boss script, at the level the road reaches it

| # | boss | level | win P=.35 | rounds | hp left | win P=.7 | rounds | hp left |
|---|---|---|---|---|---|---|---|---|
| 0 | Ratking | 1 | 66% | 7.6 | 54% | 93% | 6.6 | 64% |
| 1 | Grubnash | 2 | 71% | 7.9 | 59% | 95% | 7.5 | 70% |
| 2 | Fenrik | 4 | 64% | 10.1 | 53% | 95% | 9.0 | 67% |
| 3 | Grommash | 5 | 64% | 11.5 | 54% | 91% | 10.8 | 65% |
| 4 | Morwen | 7 | 65% | 15.5 | 61% | 95% | 13.1 | 67% |
| 5 | Gravemaw | 9 | 69% | 13.8 | 49% | 95% | 11.9 | 60% |
| 6 | Skarrix | 10 | 64% | 10.6 | 63% | 92% | 10.4 | 72% |
| 7 | Azharok | 12 | 50% | 19.0 | 65% | 84% | 16.8 | 70% |
| 8 | Vaskarra | 14 | 55% | 12.7 | 66% | 87% | 11.7 | 74% |
| 9 | Nyxareth | 15 | 68% | 18.2 | 66% | 90% | 16.7 | 71% |
| 10 | Ysolde | 17 | 69% | 16.4 | 57% | 95% | 17.1 | 67% |
| 11 | Juggernaut Prime | 18 | 61% | 13.9 | 68% | 91% | 13.5 | 76% |
| 12 | Kaelen | 20 | 63% | 9.6 | 69% | 90% | 8.5 | 78% |
| 13 | Mordreth | 21 | 60% | 14.1 | 77% | 90% | 12.7 | 83% |
| 14 | Sythera | 23 | 57% | 20.0 | 74% | 96% | 17.5 | 83% |
| 15 | Karn | 24 | 41% | 13.3 | 71% | 82% | 13.4 | 80% |
| 16 | Alune | 26 | 61% | 18.2 | 77% | 87% | 17.8 | 85% |
| 17 | Chthon | 27 | 61% | 9.8 | 73% | 75% | 8.5 | 83% |
| 18 | The Timeless One | 29 | 56% | 18.5 | 79% | 84% | 19.7 | 88% |
| 19 | Null | 30 | 46% | 15.1 | 70% | 60% | 13.4 | 82% |

No cell stalls (a fight that reaches 60 rounds counts as a loss; the anti-stall enrage makes them
impossible in practice). Karn and Null are the intended hard walls. Sustain bosses (Morwen,
Azharok, Nyxareth, Sythera, Alune, Timeless) run 15–20 rounds because they heal and shield; the
rest land in 8–15.

### Where it deliberately misses the targets

* Rank-2 bosses (level 35+) are meant to be a wall: Fenrik Rank 2 sits at 22% / 59%.
* Elites at level 20+ end with 74–84% HP (target 40–65%): with ~7% lifesteal and 40–55% crit the
  late-game kit out-heals a 7-round fight; their win rate (87–94%) is the useful signal.
* Normal fights at level 35–40 end at 82–87% HP for the same reason.
* Boss rounds for the healer scripts exceed 14.

### The threat label

`threat()` never says Trivial/Favourable for an elite or boss (clamped to Even, bosses with phases
to Dangerous); the honest ratio thresholds are 0.25 / 0.55 / 1.0 / 1.6. With the starting kit a
level-1 normal reads Favourable/Even.

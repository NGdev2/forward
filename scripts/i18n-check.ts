/* ============================================================================
 * i18n completeness check.
 *
 *   npx esbuild scripts/i18n-check.ts --bundle --platform=node --format=cjs \
 *     --log-level=warning --outfile=node_modules/.cache/forward-i18n-check.cjs \
 *   && node node_modules/.cache/forward-i18n-check.cjs
 *
 * Reports, and exits non-zero on:
 *   1. keys present in en.ts but missing from fr.ts
 *   2. literal t('…') / tn('…') keys used in src/ that do not exist in en.ts
 *      (tn keys are checked as `<key>_one` + `<key>_other`, or the bare key)
 *   3. content ids (items, enemies, bosses, abilities, statuses, sets,
 *      consumables, encounters, biomes, passives, moves, phases, enums) that
 *      have no French entry — these fall back to English at runtime, so the
 *      game still works, but the list must be empty for a complete translation.
 * ========================================================================== */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { BASE_ITEMS, ITEM_SETS, ABILITY_LABELS } from '../src/game/data/items';
import { ENEMY_BASES, ARCHETYPE_MOVES, ARCHETYPE_TRAITS } from '../src/game/data/enemies';
import { BOSS_BASES, BOSS_SCRIPTS, PASSIVE_INFO } from '../src/game/data/bosses';
import { ABILITIES, STATUS_INFO } from '../src/game/data/abilities';
import { CONSUMABLES } from '../src/game/data/consumables';
import { BIOMES } from '../src/screens/run/biomes';
import { EQUIP_SLOTS, PERCENT_STATS, TALENT_KEYS } from '../src/game/types';
import { RARITY_TIERS, STAT_LABELS } from '../src/game/config';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(name)) out.push(full);
  }
  return out;
}

/* 1. EN → FR */
const missingInFr = Object.keys(en).filter(k => !(k in fr));

/* 2. literal keys used in code */
const usedMissing: string[] = [];
const files = walk(SRC).filter(f => !f.includes(join('src', 'i18n') + '/'));
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = file.slice(ROOT.length + 1);
  for (const m of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
    if (!(m[1] in en)) usedMissing.push(`${rel}: t('${m[1]}')`);
  }
  for (const m of text.matchAll(/\btn\(\s*'([^']+)'/g)) {
    const k = m[1];
    if (!(`${k}_one` in en && `${k}_other` in en) && !(k in en)) usedMissing.push(`${rel}: tn('${k}')`);
  }
}

/* 3. content coverage in FR */
const contentMissing: string[] = [];
const need = (key: string) => {
  if (!(key in fr)) contentMissing.push(key);
};
for (const b of BASE_ITEMS) need(`item.${b.id}`);
for (const s of ITEM_SETS) {
  need(`set.${s.id}`);
  need(`set.${s.id}.flavor`);
  for (const bonus of s.bonuses) need(`set.${s.id}.bonus${bonus.pieces}`);
}
for (const id of Object.keys(ABILITY_LABELS)) need(`family.${id}`);
for (const e of ENEMY_BASES) need(`enemy.${e.id}`);
for (const a of Object.keys(ARCHETYPE_TRAITS)) need(`archetype.${a}`);
for (const p of ['Elite', 'Savage', 'Ancient', 'Dread', 'Warscarred']) need(`elite.${p}`);
for (const b of BOSS_BASES) {
  need(`boss.${b.id}`);
  need(`boss.${b.id}.title`);
  need(`boss.${b.id}.flavor`);
  const script = BOSS_SCRIPTS[b.id];
  if (script) {
    script.phases.forEach((p, i) => {
      need(`boss.${b.id}.phase${i}.name`);
      need(`boss.${b.id}.phase${i}.banner`);
    });
  }
}
const moveLabels = new Set<string>(['Stunned']);
for (const moves of Object.values(ARCHETYPE_MOVES)) {
  for (const m of moves) {
    moveLabels.add(m.label);
    if (m.payoff) moveLabels.add(m.payoff.label);
  }
}
for (const script of Object.values(BOSS_SCRIPTS)) {
  for (const phase of script.phases) {
    for (const m of phase.moves) {
      moveLabels.add(m.label);
      if (m.payoff) moveLabels.add(m.payoff.label);
    }
  }
}
for (const label of moveLabels) need(`move.${label}`);
for (const p of Object.keys(PASSIVE_INFO)) {
  need(`passive.${p}`);
  need(`passive.${p}.desc`);
}
for (const a of ABILITIES) {
  need(`ability.${a.id}`);
  need(`ability.${a.id}.desc`);
}
for (const s of Object.keys(STATUS_INFO)) {
  need(`status.${s}`);
  need(`status.${s}.desc`);
}
for (const c of CONSUMABLES) {
  need(`consumable.${c.id}`);
  need(`consumable.${c.id}.desc`);
}
for (const k of ['battle', 'gold', 'treasure', 'rest', 'elite', 'shrine', 'shop', 'mystery']) {
  need(`encounter.${k}`);
  need(`encounter.${k}.desc`);
}
for (const b of BIOMES) {
  need(`biome.${b.id}`);
  need(`biome.${b.id}.flavor`);
}
/* fixed enums must exist in BOTH dictionaries */
const enumKeys: string[] = [];
for (const k of Object.keys(STAT_LABELS)) enumKeys.push(`stat.${k}`, `affix_prefix.${k}`, `affix_suffix.${k}`);
for (const s of EQUIP_SLOTS) enumKeys.push(`slot.${s}`);
for (const r of RARITY_TIERS) enumKeys.push(`rarity.${r.id}`);
for (const e of ['beast', 'metal', 'fire', 'water', 'void', 'holy']) enumKeys.push(`element.${e}`);
for (const k of TALENT_KEYS) enumKeys.push(`talent.${k}`, `talent.${k}.desc`);
for (const k of enumKeys) {
  if (k.startsWith('affix_')) need(k);
  else {
    need(k);
    if (!(k in en)) usedMissing.push(`(enum) ${k} missing in en.ts`);
  }
}
void PERCENT_STATS;

/* report */
const section = (title: string, list: string[]) => {
  console.log(`\n${title}: ${list.length}`);
  for (const l of list) console.log(`  - ${l}`);
};
section('EN keys missing in FR', missingInFr);
section("t('…') keys used in src but missing in en.ts", usedMissing);
section('Content ids without a French entry', contentMissing);
console.log(`\nen: ${Object.keys(en).length} keys · fr: ${Object.keys(fr).length} keys`);

const bad = missingInFr.length + usedMissing.length + contentMissing.length;
console.log(bad === 0 ? '\ni18n check: OK' : `\ni18n check: ${bad} problem(s)`);
process.exit(bad === 0 ? 0 : 1);

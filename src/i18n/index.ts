/* ============================================================================
 * FORWARD — localisation foundation.
 *
 *   t('title.continue')                       -> "Continue the run"
 *   t('stats.bosses_felled', { n: 3 })        -> "3 bosses felled"
 *
 * Keys are dotted and flat (one string per key, no nesting). Lookup order is
 * current language → English → the key itself, so a missing translation is
 * never a crash and always visible in QA. See README.md for conventions.
 * ========================================================================== */

import type { Language } from '../game/types';
import { en } from './en';
import { fr } from './fr';

export type Dictionary = Record<string, string>;
export type Params = Record<string, string | number>;

const DICTS: Record<Language, Dictionary> = { en, fr };

export const LANGUAGES: { id: Language; label: string; native: string }[] = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'fr', label: 'French', native: 'Français' }
];

let current: Language = 'en';
const listeners = new Set<(lang: Language) => void>();

export function getLanguage(): Language {
  return current;
}

/** Switches the active language and notifies subscribers (screens re-render). */
export function setLanguage(lang: Language) {
  const next: Language = lang in DICTS ? lang : 'en';
  if (next === current) return;
  current = next;
  document.documentElement.lang = next;
  for (const cb of Array.from(listeners)) {
    try {
      cb(next);
    } catch (err) {
      console.warn('[i18n] listener failed', err);
    }
  }
}

/** Subscribe to language changes. Returns the unsubscribe function. */
export function onLanguageChange(cb: (lang: Language) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** True when the key has a translation in the current language or English. */
export function hasKey(key: string): boolean {
  return key in DICTS[current] || key in en;
}

/**
 * Raw lookup in the CURRENT language only — no English fallback, no key echo.
 * Used by the content layer, which falls back to the data table's own field.
 */
export function tryT(key: string): string | undefined {
  return DICTS[current][key];
}

/** All keys of a dictionary — for the i18n check script. */
export function dictionaryKeys(lang: Language): string[] {
  return Object.keys(DICTS[lang]);
}

/**
 * Translates a key, interpolating `{name}` placeholders from `params`.
 * Unknown placeholders are left as-is; unknown keys return the key.
 */
export function t(key: string, params?: Params): string {
  const raw = DICTS[current][key] ?? en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? m : String(v);
  });
}

/**
 * Plural helper: picks `<key>_one` when n === 1, otherwise `<key>_other`, and
 * interpolates `{n}` (plus any extra params).
 *   tn('stats.bosses_felled', 3)  // uses stats.bosses_felled_other
 */
export function tn(key: string, n: number, params?: Params): string {
  const suffix = Math.abs(n) === 1 ? '_one' : '_other';
  const full = `${key}${suffix}`;
  return t(hasKey(full) ? full : key, { n, ...(params ?? {}) });
}

/** Locale-aware integer formatting (thin wrapper so screens never hard-code a locale). */
export function fmtNum(n: number): string {
  const locale = current === 'fr' ? 'fr-FR' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

/* Content dictionaries (item/enemy/boss/… names keyed by id) live in content.ts. */
export * from './content';

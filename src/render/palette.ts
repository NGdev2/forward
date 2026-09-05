/* ============================================================================
 * Colour + material foundation for every procedural sprite.
 * Pure functions, no canvas state. Kept allocation-light: colour strings are
 * memoised because the sprite layer asks for the same shades every frame.
 * ========================================================================== */

import type { Rarity } from '../game/types';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

const HEX_CACHE = new Map<string, RGB>();

export function toRgb(hex: string): RGB {
  const cached = HEX_CACHE.get(hex);
  if (cached) return cached;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  const rgb = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  HEX_CACHE.set(hex, rgb);
  return rgb;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

function css(r: number, g: number, b: number): string {
  return `#${((1 << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)).toString(16).slice(1)}`;
}

const MIX_CACHE = new Map<string, string>();

/** Blends two colours. `t` 0 = a, 1 = b. */
export function mix(a: string, b: string, t: number): string {
  const key = `${a}|${b}|${t.toFixed(3)}`;
  const hit = MIX_CACHE.get(key);
  if (hit) return hit;
  const x = toRgb(a);
  const y = toRgb(b);
  const out = css(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t);
  if (MIX_CACHE.size < 4000) MIX_CACHE.set(key, out);
  return out;
}

/** Lightens toward a warm white — used for highlights and rim light. */
export function lighten(hex: string, t: number): string {
  return mix(hex, '#fff6e6', t);
}

/** Darkens toward a cool near-black — keeps shadows from going muddy. */
export function darken(hex: string, t: number): string {
  return mix(hex, '#0d1020', t);
}

/** Pushes a colour toward its saturated self (fake chroma boost). */
export function vivid(hex: string, t: number): string {
  const { r, g, b } = toRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const mid = (max + min) / 2;
  return css(r + (r - mid) * t, g + (g - mid) * t, b + (b - mid) * t);
}

const ALPHA_CACHE = new Map<string, string>();

export function alpha(hex: string, a: number): string {
  const key = `${hex}|${a.toFixed(3)}`;
  const hit = ALPHA_CACHE.get(key);
  if (hit) return hit;
  const { r, g, b } = toRgb(hex);
  const out = `rgba(${r},${g},${b},${a})`;
  if (ALPHA_CACHE.size < 4000) ALPHA_CACHE.set(key, out);
  return out;
}

/* ------------------------------------------------------------- world tone -- */

export const INK = '#0e1122';
export const SKIN = '#f0c19c';
export const SKIN_MID = '#d99b73';
export const SKIN_DARK = '#a86b4c';
export const HAIR = '#3b2a2f';
export const LEATHER = '#7a4f31';
export const LEATHER_DARK = '#4a2c1b';
export const CLOTH = '#3e4a75';
export const STEEL = '#b9c4dc';
export const STEEL_DARK = '#5b6683';
export const BONE = '#efe6cf';
export const GOLD = '#f4c25a';

/* -------------------------------------------------------------- materials -- */

/**
 * Material treatment driven by item rarity. Higher tiers get richer metal,
 * stronger rim light and — from legendary up — an emissive aura.
 */
export interface Material {
  /** Deepest shadow tone. */
  lo: string;
  /** Body tone. */
  base: string;
  /** Lit tone. */
  hi: string;
  /** Specular / rim colour. */
  spec: string;
  /** Trim, gem and filigree colour. */
  accent: string;
  /** Glow colour, empty when the material does not emit. */
  glow: string;
  /** 0..1 aura strength. */
  emissive: number;
  /** 0..1 how metallic (drives the specular band). */
  metal: number;
}

const RARITY_TINT: Record<Rarity, { tint: string; amount: number; accent: string; emissive: number }> = {
  common: { tint: '#8d97ae', amount: 0.3, accent: '#6f7a94', emissive: 0 },
  uncommon: { tint: '#5ee88f', amount: 0.14, accent: '#3fbf72', emissive: 0 },
  rare: { tint: '#4fa8f2', amount: 0.2, accent: '#7cc8ff', emissive: 0.12 },
  epic: { tint: '#b266f2', amount: 0.26, accent: '#dcb0ff', emissive: 0.28 },
  legendary: { tint: '#f2a541', amount: 0.42, accent: '#ffe6a6', emissive: 0.55 },
  mythic: { tint: '#ff4d6d', amount: 0.46, accent: '#ffc6d2', emissive: 0.85 }
};

const MAT_CACHE = new Map<string, Material>();

/**
 * Builds a material from a base tone and a rarity. `metal` 0 = cloth/leather,
 * 1 = polished metal.
 */
export function material(baseTone: string, rarity: Rarity | null, metal = 0.7): Material {
  const key = `${baseTone}|${rarity ?? 'none'}|${metal}`;
  const hit = MAT_CACHE.get(key);
  if (hit) return hit;
  const spec = rarity ? RARITY_TINT[rarity] : RARITY_TINT.common;
  const base = mix(baseTone, spec.tint, spec.amount);
  const mat: Material = {
    lo: darken(base, 0.52 - metal * 0.1),
    base,
    hi: lighten(base, 0.26 + metal * 0.22),
    spec: lighten(mix(base, spec.tint, 0.3), 0.55 + metal * 0.3),
    accent: spec.accent,
    glow: spec.emissive > 0 ? spec.tint : '',
    emissive: spec.emissive,
    metal
  };
  MAT_CACHE.set(key, mat);
  return mat;
}

/** Deterministic 32-bit hash — the backbone of every "unknown id" fallback. */
export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable 0..1 stream from a seed, so a given id always looks the same. */
export function rand01(seed: number, salt: number): number {
  let x = (seed ^ (salt * 0x9e3779b9)) >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;
  x >>>= 0;
  return x / 4294967296;
}

export function pick<T>(list: readonly T[], seed: number, salt: number): T {
  return list[Math.floor(rand01(seed, salt) * list.length) % list.length];
}

/* ============================================================================
 * Graphics quality.
 *
 * Measured on a mid-range phone (Helio G90T, 3× screen): the interface alone
 * runs at ~56 fps; the full-screen canvas is what costs. Two levers:
 *
 *   resolution — canvas backing-store scale. 2.5× on a 3× phone is 2.8× the
 *                pixels of 1.5× for a barely visible gain in sharpness.
 *   animFps    — how often a character's pose is re-rendered. Between steps the
 *                cached image of the pose is reused (see sprites.ts).
 *
 * 'auto' picks Balanced on touch devices and High elsewhere.
 * ========================================================================== */

export type GraphicsQuality = 'auto' | 'high' | 'balanced';

interface Profile {
  /** Max canvas pixels per CSS pixel. */
  maxScale: number;
  /** Character pose re-renders per second. */
  animFps: number;
  /** Multiplier on ambient particle counts. */
  particles: number;
}

const PROFILES: Record<'high' | 'balanced', Profile> = {
  high: { maxScale: 2.5, animFps: 30, particles: 1 },
  balanced: { maxScale: 1.5, animFps: 20, particles: 0.6 }
};

let setting: GraphicsQuality = 'auto';
const listeners = new Set<() => void>();

function isTouchDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** The profile actually in use ('auto' resolved for this device). */
export function effectiveQuality(): 'high' | 'balanced' {
  if (setting === 'auto') return isTouchDevice() ? 'balanced' : 'high';
  return setting;
}

function profile(): Profile {
  return PROFILES[effectiveQuality()];
}

export function getGraphicsQuality(): GraphicsQuality {
  return setting;
}

/** Changes the setting; canvases listening via onQualityChange resize. */
export function setGraphicsQuality(q: GraphicsQuality) {
  if (q === setting) return;
  setting = q;
  for (const fn of listeners) fn();
}

export function onQualityChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Backing-store scale for a full-screen canvas. */
export function canvasScale(): number {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  return Math.min(dpr, profile().maxScale);
}

/** Character pose re-renders per second. */
export function animFps(): number {
  return profile().animFps;
}

/** Multiplier for decorative particle counts (motes, stars, weather). */
export function particleScale(): number {
  return profile().particles;
}

/* ============================================================================
 * SpriteKit adapter.
 *
 * All the actual drawing lives in the parametric rigs:
 *   hero.ts      — layered humanoid rig, gear-driven (armour class, helm type,
 *                  weapon family, offhand, cape, enchant glow)
 *   creatures.ts — parametric bestiary, design derived from the enemy id
 *
 * Both rigs draw in local units around origin (0,0) = the point the figure
 * stands on, with the hero roughly 116 units tall. This file only handles
 * placement, scaling, facing and portrait framing.
 * ========================================================================== */

import type { CreaturePose, DrawOpts, HeroLook, HeroPose, SpriteKit } from './api';
import { drawHeroRig, HERO_BOUNDS } from './hero';
import { creatureDesign, creatureHeight, drawCreatureBody } from './creatures';
import { animFps } from './quality';

/** `scale` 1 means "about 100px tall" in the public contract. */
const HERO_UNIT = 100 / HERO_BOUNDS.h;

/**
 * `creatureHeight()` is the design's nominal body height, but horns, wings,
 * crowns and auras routinely push well past it — a boss normalised on the
 * nominal figure alone renders half off-screen. So the true painted extent is
 * measured once per creature id by rasterising it and reading the alpha
 * bounding box, then cached.
 */
export interface CreatureExtent {
  /** Painted height above the feet, in the design's own local units. */
  height: number;
  /** Painted width, in the same units. */
  width: number;
}

const EXTENT_CACHE = new Map<string, CreatureExtent>();
const MEASURE_BOX = 480;

/** Measured painted bounds of a creature, in its own local units. Cached. */
export function creatureExtent(id: string): CreatureExtent {
  const cached = EXTENT_CACHE.get(id);
  if (cached !== undefined) return cached;

  const nominal = creatureHeight(creatureDesign(id));
  const result: CreatureExtent = { height: nominal, width: nominal * 0.9 };
  try {
    const cv = document.createElement('canvas');
    cv.width = MEASURE_BOX;
    cv.height = MEASURE_BOX;
    const c = cv.getContext('2d', { willReadFrequently: true });
    if (c) {
      // Draw at a known unit with the feet on the bottom quarter line.
      const k = (MEASURE_BOX * 0.5) / nominal;
      const footY = MEASURE_BOX * 0.85;
      c.save();
      c.translate(MEASURE_BOX / 2, footY);
      c.scale(k, k);
      drawCreatureBody(c, id, 'idle', { time: 0.5 });
      c.restore();

      const data = c.getImageData(0, 0, MEASURE_BOX, MEASURE_BOX).data;
      let top = -1;
      let left = MEASURE_BOX;
      let right = -1;
      for (let y = 0; y < MEASURE_BOX; y++) {
        for (let x = 0; x < MEASURE_BOX; x++) {
          if (data[(y * MEASURE_BOX + x) * 4 + 3] <= 24) continue;
          if (top < 0) top = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
      if (top >= 0) {
        result.height = Math.max(nominal * 0.6, (footY - top) / k);
        result.width = Math.max(nominal * 0.4, (right - left) / k);
      }
    }
  } catch {
    /* canvas unavailable — the nominal figure is a serviceable fallback */
  }
  EXTENT_CACHE.set(id, result);
  return result;
}

function paintedHeight(id: string): number {
  return creatureExtent(id).height;
}

/* ------------------------------------------------------------ hit flashes --
 * A white hit-flash is composited with `source-atop`, which only isolates the
 * figure if the figure is alone on the surface. Painted straight onto the
 * scene it turns into a white rectangle over the sky. So a flashing figure is
 * drawn onto a transparent scratch layer first, flashed there, then blitted.
 */

let scratch: HTMLCanvasElement | null = null;

function scratchFor(target: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== target.width || scratch.height !== target.height) {
    scratch.width = target.width;
    scratch.height = target.height;
  }
  const c = scratch.getContext('2d');
  if (!c) return null;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, scratch.width, scratch.height);
  return c;
}

/**
 * Runs `paint` on an isolated layer aligned with `c`, then blits it back.
 * Falls back to painting directly if no scratch surface is available.
 */
function isolated(c: CanvasRenderingContext2D, paint: (c: CanvasRenderingContext2D) => void) {
  const layer = scratchFor(c.canvas);
  if (!layer) {
    paint(c);
    return;
  }
  layer.setTransform(c.getTransform());
  paint(layer);
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(layer.canvas, 0, 0);
  c.restore();
}

/* ---------------------------------------------------------- pose cache --
 * Rebuilding a rig from hundreds of vector shapes and gradients every frame
 * was the single biggest cost on phones. Instead each on-screen figure keeps
 * one offscreen image ("slot") keyed by who it is, its pose, its on-screen
 * size bucket and facing. The slot is re-rendered only when the animation
 * advances a step (quality.animFps per second); every other frame is a
 * single drawImage. Hit flashes bypass the cache and draw live.
 */

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

interface Slot {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  step: number;
}

const MAX_SLOTS = 24;
/** Larger than this and caching costs more memory than it saves. */
const MAX_SLOT_PX = 2048 * 1536;
const slots = new Map<string, Slot>();
const spare: HTMLCanvasElement[] = [];

function slotFor(key: string, w: number, h: number): Slot | null {
  let slot = slots.get(key);
  if (slot) {
    // LRU: most recently used last.
    slots.delete(key);
    slots.set(key, slot);
    return slot;
  }
  while (slots.size >= MAX_SLOTS) {
    const oldest = slots.keys().next().value as string;
    const gone = slots.get(oldest);
    slots.delete(oldest);
    if (gone && spare.length < 6) spare.push(gone.canvas);
  }
  const canvas = spare.pop() ?? document.createElement('canvas');
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext('2d');
  if (!g) return null;
  slot = { canvas, g, step: Number.NaN };
  slots.set(key, slot);
  return slot;
}

/**
 * Draws a figure through the pose cache.
 * `unit` maps rig units to the caller's user space; `box` is the figure's
 * paintable area in rig units (feet at 0,0, before facing).
 */
function cachedFigure(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  unit: number,
  facing: 1 | -1,
  alpha: number | undefined,
  id: string,
  box: Box,
  time: number,
  render: (g: CanvasRenderingContext2D, time: number) => void
) {
  const m = c.getTransform();
  const devicePerUser = Math.hypot(m.a, m.b);
  // Size buckets 6% apart: a figure scaling smoothly (walking toward the
  // camera) re-renders a few times, not every frame.
  const bucket = Math.round(Math.log(Math.max(1e-4, unit * devicePerUser)) / Math.log(1.06));
  const k = Math.pow(1.06, bucket);
  const w = Math.max(1, Math.ceil((box.r - box.l) * k));
  const h = Math.max(1, Math.ceil((box.b - box.t) * k));
  const fps = animFps();
  const step = Math.round(time * fps);

  const slot = w * h <= MAX_SLOT_PX ? slotFor(`${id}|${bucket}|${facing}`, w, h) : null;
  if (!slot) {
    // Too big to cache: draw live, like before.
    c.save();
    c.translate(x, y);
    c.scale(unit * facing, unit);
    if (alpha !== undefined) c.globalAlpha *= alpha;
    render(c, time);
    c.restore();
    return;
  }
  if (slot.step !== step) {
    const g = slot.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    // Mirror inside the slot so the blit is a plain axis-aligned copy.
    g.setTransform(k * facing, 0, 0, k, facing > 0 ? -box.l * k : box.r * k, -box.t * k);
    render(g, step / fps);
    slot.step = step;
  }
  const left = facing > 0 ? box.l : -box.r;
  c.save();
  if (alpha !== undefined) c.globalAlpha *= alpha;
  c.drawImage(slot.canvas, x + left * unit, y + box.t * unit, (box.r - box.l) * unit, (box.b - box.t) * unit);
  c.restore();
}

function lookKey(look: HeroLook): string {
  return [
    look.weaponId, look.weaponRarity, look.offhandId, look.offhandRarity, look.helmId, look.helmRarity,
    look.armorId, look.armorRarity, look.bootsId, look.bootsRarity, look.trinketId, look.trinketRarity
  ].join(',');
}

/** Hero rig paint area, in rig units: weapon reach, aura and shadow included. */
const HERO_BOX: Box = { l: -HERO_BOUNDS.w, t: -HERO_BOUNDS.h * 1.3, r: HERO_BOUNDS.w, b: HERO_BOUNDS.h * 0.14 };

const CREATURE_BOX = new Map<string, Box>();
function creatureBox(id: string): Box {
  let box = CREATURE_BOX.get(id);
  if (!box) {
    const ext = creatureExtent(id);
    // Generous: attack lunges, wings, auras and ground rings reach past the
    // idle silhouette that was measured.
    const half = ext.width * 0.62 + ext.height * 0.5;
    box = { l: -half, t: -ext.height * 1.35, r: half, b: ext.height * 0.3 };
    CREATURE_BOX.set(id, box);
  }
  return box;
}

export class Sprites implements SpriteKit {
  drawHero(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    look: HeroLook,
    pose: HeroPose,
    opts: DrawOpts
  ) {
    const facing = opts.facing ?? 1;
    if (!opts.flash) {
      cachedFigure(c, x, y, scale * HERO_UNIT, facing, opts.alpha, `h:${lookKey(look)}:${pose}`, HERO_BOX, opts.time, (g, time) =>
        drawHeroRig(g, look, pose, { ...opts, time, alpha: undefined, flash: undefined })
      );
      return;
    }
    const paint = (g: CanvasRenderingContext2D) => {
      g.save();
      g.translate(x, y);
      g.scale(scale * HERO_UNIT * facing, scale * HERO_UNIT);
      drawHeroRig(g, look, pose, opts);
      g.restore();
      if (opts.flash) flashOver(g, x, y, scale * HERO_UNIT, opts.flash);
    };
    isolated(c, paint);
  }

  drawCreature(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    enemyId: string,
    pose: CreaturePose,
    opts: DrawOpts
  ) {
    const facing = opts.facing ?? 1;
    // Normalise so `scale` 1 is ~100px of *painted* silhouette, regardless of
    // how large or horned the design happens to be.
    const unit = (100 / paintedHeight(enemyId)) * scale;
    if (!opts.flash) {
      cachedFigure(c, x, y, unit, facing, opts.alpha, `c:${enemyId}:${pose}`, creatureBox(enemyId), opts.time, (g, time) =>
        drawCreatureBody(g, enemyId, pose, { ...opts, time, alpha: undefined, flash: undefined })
      );
      return;
    }
    const paint = (g: CanvasRenderingContext2D) => {
      g.save();
      g.translate(x, y);
      g.scale(unit * facing, unit);
      drawCreatureBody(g, enemyId, pose, opts);
      g.restore();
    };
    isolated(c, paint);
  }

  creaturePortrait(enemyId: string, size: number): HTMLCanvasElement {
    const h = paintedHeight(enemyId);
    return this.portrait(size, (c, dpr) => {
      // Fit the silhouette into the box with a small margin.
      const k = ((size * 0.82) / h) * dpr;
      c.translate((size * dpr) / 2, size * dpr * 0.93);
      c.scale(k, k);
      drawCreatureBody(c, enemyId, 'idle', { time: 0.6 });
    });
  }

  heroPortrait(look: HeroLook, size: number, pose: HeroPose = 'idle'): HTMLCanvasElement {
    return this.portrait(size, (c, dpr) => {
      const k = ((size * 0.86) / HERO_BOUNDS.h) * dpr;
      c.translate((size * dpr) / 2, size * dpr * 0.95);
      c.scale(k, k);
      drawHeroRig(c, look, pose, { time: 0.4 });
    });
  }

  /* ---------------------------------------------------------------- utils -- */

  private portrait(
    size: number,
    paint: (c: CanvasRenderingContext2D, dpr: number) => void
  ): HTMLCanvasElement {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const c = canvas.getContext('2d');
    if (c) {
      c.imageSmoothingQuality = 'high';
      paint(c, dpr);
    }
    return canvas;
  }

}

/** White hit-flash for the hero; the creature rig paints its own. */
function flashOver(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  unit: number,
  amount: number
) {
  const w = HERO_BOUNDS.w * unit;
  const h = HERO_BOUNDS.h * unit;
  c.save();
  c.globalCompositeOperation = 'source-atop';
  c.globalAlpha = Math.min(1, Math.max(0, amount)) * 0.8;
  c.fillStyle = '#fff';
  c.fillRect(x - w, y - h * 1.15, w * 2, h * 1.3);
  c.restore();
}

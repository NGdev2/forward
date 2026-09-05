/* ============================================================================
 * Low-level vector drawing helpers shared by the hero and creature renderers.
 * Everything works in sprite-local coordinates (feet at y = 0, up is -y) so
 * gradients can be cached per context and reused across frames.
 * ========================================================================== */

import { alpha, darken, lighten, type Material } from './palette';

type Ctx = CanvasRenderingContext2D;

/* -------------------------------------------------------- gradient cache -- */

const GRAD_CACHE = new WeakMap<Ctx, Map<string, CanvasGradient>>();

function cacheFor(c: Ctx): Map<string, CanvasGradient> {
  let m = GRAD_CACHE.get(c);
  if (!m) {
    m = new Map();
    GRAD_CACHE.set(c, m);
  }
  if (m.size > 600) m.clear();
  return m;
}

/** Cached linear gradient in sprite-local space. */
export function linGrad(
  c: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: [number, string][]
): CanvasGradient {
  const m = cacheFor(c);
  let key = `l${x0}|${y0}|${x1}|${y1}`;
  for (const s of stops) key += `|${s[0]}${s[1]}`;
  let g = m.get(key);
  if (!g) {
    g = c.createLinearGradient(x0, y0, x1, y1);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    m.set(key, g);
  }
  return g;
}

/** Cached radial gradient in sprite-local space. */
export function radGrad(
  c: Ctx,
  x0: number,
  y0: number,
  r0: number,
  x1: number,
  y1: number,
  r1: number,
  stops: [number, string][]
): CanvasGradient {
  const m = cacheFor(c);
  let key = `r${x0}|${y0}|${r0}|${x1}|${y1}|${r1}`;
  for (const s of stops) key += `|${s[0]}${s[1]}`;
  let g = m.get(key);
  if (!g) {
    g = c.createRadialGradient(x0, y0, r0, x1, y1, r1);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    m.set(key, g);
  }
  return g;
}

/* ------------------------------------------------------------- primitives -- */

/** Outlines the current path with the house ink colour. */
export function ink(c: Ctx, width = 1.6, tone = 'rgba(9,11,22,0.62)') {
  c.strokeStyle = tone;
  c.lineWidth = width;
  c.lineJoin = 'round';
  c.stroke();
}

/** Soft contact shadow on the ground plane. */
export function groundShadow(c: Ctx, w: number, h: number, opacity = 0.42, y = 0) {
  c.save();
  c.fillStyle = radGrad(c, 0, y, 0, 0, y, w, [
    [0, `rgba(4,6,14,${opacity})`],
    [0.55, `rgba(4,6,14,${opacity * 0.55})`],
    [1, 'rgba(4,6,14,0)']
  ]);
  c.beginPath();
  c.ellipse(0, y, w, h, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/**
 * Tapered limb segment: a capsule from (x0,y0) to (x1,y1) whose width eases
 * from `w0` to `w1`. Reads far better than a round-capped stroke.
 */
export function limb(
  c: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  w0: number,
  w1: number
) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 0.001;
  const nx = -dy / len;
  const ny = dx / len;
  const h0 = w0 / 2;
  const h1 = w1 / 2;
  c.beginPath();
  c.moveTo(x0 + nx * h0, y0 + ny * h0);
  c.lineTo(x1 + nx * h1, y1 + ny * h1);
  c.arc(x1, y1, h1, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
  c.lineTo(x0 - nx * h0, y0 - ny * h0);
  c.arc(x0, y0, h0, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
  c.closePath();
}

/** Two-segment limb (upper + lower) with a joint, filled as one silhouette. */
export function jointLimb(
  c: Ctx,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  w0: number,
  w1: number,
  w2: number,
  fill: string | CanvasGradient,
  outline = true
) {
  c.fillStyle = fill;
  limb(c, ax, ay, bx, by, w0, w1);
  c.fill();
  if (outline) ink(c, 1.3);
  limb(c, bx, by, cx, cy, w1, w2);
  c.fill();
  if (outline) ink(c, 1.3);
}

/** Rounded blob body with a lit top-left and a dark bottom-right. */
export function shadedEllipse(
  c: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  mat: Material,
  rot = 0
) {
  c.fillStyle = radGrad(c, x - rx * 0.4, y - ry * 0.45, rx * 0.1, x, y, rx * 1.5, [
    [0, mat.hi],
    [0.5, mat.base],
    [1, mat.lo]
  ]);
  c.beginPath();
  c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  c.fill();
  ink(c, 1.8);
}

/** Draws a closed polygon from a flat point list. */
export function poly(c: Ctx, pts: number[]) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
}

/** Curved spike / horn / claw. `curve` bends it sideways. */
export function spike(
  c: Ctx,
  x: number,
  y: number,
  len: number,
  width: number,
  angle: number,
  curve = 0.35
) {
  const tx = x + Math.cos(angle) * len;
  const ty = y + Math.sin(angle) * len;
  const px = -Math.sin(angle);
  const py = Math.cos(angle);
  const mx = x + Math.cos(angle) * len * 0.5 + px * len * curve;
  const my = y + Math.sin(angle) * len * 0.5 + py * len * curve;
  c.beginPath();
  c.moveTo(x + px * width * 0.5, y + py * width * 0.5);
  c.quadraticCurveTo(mx + px * width * 0.3, my + py * width * 0.3, tx, ty);
  c.quadraticCurveTo(mx - px * width * 0.5, my - py * width * 0.5, x - px * width * 0.5, y - py * width * 0.5);
  c.closePath();
}

/** Additive glow disc. Cheap and reads as light. */
export function glow(c: Ctx, x: number, y: number, r: number, color: string, strength = 0.6) {
  if (r <= 0 || strength <= 0) return;
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.fillStyle = radGrad(c, x, y, 0, x, y, r, [
    [0, alpha(color, 0.85 * strength)],
    [0.45, alpha(color, 0.3 * strength)],
    [1, alpha(color, 0)]
  ]);
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Rim light along one edge of the last filled shape's bounding arc. */
export function rimArc(
  c: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  color: string,
  width = 2,
  a = 0.5
) {
  c.save();
  c.strokeStyle = alpha(color, a);
  c.lineWidth = width;
  c.lineCap = 'round';
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, from, to);
  c.stroke();
  c.restore();
}

/** Glowing eye with a bright core and a bloom. */
export function eye(c: Ctx, x: number, y: number, r: number, color: string, lidClosed = 0) {
  if (lidClosed >= 1) {
    c.strokeStyle = 'rgba(10,10,18,0.8)';
    c.lineWidth = Math.max(1, r * 0.5);
    c.beginPath();
    c.moveTo(x - r, y);
    c.lineTo(x + r, y);
    c.stroke();
    return;
  }
  glow(c, x, y, r * 3.2, color, 0.55);
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(x, y, r, r * (1 - lidClosed * 0.7), 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = lighten(color, 0.75);
  c.beginPath();
  c.ellipse(x + r * 0.22, y - r * 0.24, r * 0.42, r * 0.34, 0, 0, Math.PI * 2);
  c.fill();
}

/** Cartoon eye: white sclera, dark pupil, specular dot. For humanoids. */
export function toonEye(c: Ctx, x: number, y: number, r: number, look = 0, angry = 0) {
  c.fillStyle = '#f6f2ea';
  c.beginPath();
  c.ellipse(x, y, r, r * 1.05, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#161a2c';
  c.beginPath();
  c.arc(x + look * r * 0.35, y + r * 0.08, r * 0.55, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.9)';
  c.beginPath();
  c.arc(x + look * r * 0.35 + r * 0.2, y - r * 0.2, r * 0.2, 0, Math.PI * 2);
  c.fill();
  if (angry > 0) {
    c.strokeStyle = '#1b1524';
    c.lineWidth = r * 0.55;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x - r * 1.1, y - r * (1.1 + angry * 0.3));
    c.lineTo(x + r * 0.9, y - r * (0.4 + angry * 0.1));
    c.stroke();
  }
}

/** Metal plate with a specular sweep — the workhorse for armour and blades. */
export function metalShape(
  c: Ctx,
  mat: Material,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  outlineWidth = 1.5
) {
  c.fillStyle = linGrad(c, x0, y0, x1, y1, [
    [0, mat.hi],
    [0.32, mat.base],
    [0.62, darken(mat.base, 0.18)],
    [0.86, mat.lo],
    [1, mat.base]
  ]);
  c.fill();
  if (outlineWidth > 0) ink(c, outlineWidth);
}

/** Emissive treatment applied to a just-filled path for high rarities. */
export function enchantFill(c: Ctx, mat: Material, x: number, y: number, r: number) {
  if (mat.emissive <= 0 || !mat.glow) return;
  glow(c, x, y, r, mat.glow, mat.emissive * 0.7);
}

/** Soft drop shadow behind a shape group. */
export function withShadow(c: Ctx, blur: number, dy: number, fn: () => void) {
  c.save();
  c.shadowColor = 'rgba(3,5,12,0.55)';
  c.shadowBlur = blur;
  c.shadowOffsetY = dy;
  fn();
  c.restore();
}

/** Wobbly organic outline used by slimes and spectres. */
export function blobPath(
  c: Ctx,
  x: number,
  y: number,
  rx: number,
  ry: number,
  wobble: number,
  phase: number,
  lobes = 6
) {
  c.beginPath();
  const steps = lobes * 6;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const k = 1 + Math.sin(a * lobes + phase) * wobble;
    const px = x + Math.cos(a) * rx * k;
    const py = y + Math.sin(a) * ry * k;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
}

export { alpha, darken, lighten };

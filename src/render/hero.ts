/* ============================================================================
 * The player character: a jointed vector rig with equipment layers.
 *
 * Local space: feet on y = 0, up is -y, roughly 104 units tall at scale 1.
 * Everything is forward-kinematic so poses can be blended and the silhouette
 * stays readable at phone sizes.
 * ========================================================================== */

import type { DrawOpts, HeroLook, HeroPose } from './api';
import {
  BONE,
  CLOTH,
  GOLD,
  HAIR,
  LEATHER,
  LEATHER_DARK,
  SKIN,
  SKIN_DARK,
  SKIN_MID,
  STEEL,
  alpha,
  darken,
  lighten,
  material,
  mix,
  type Material
} from './palette';
import {
  blobPath,
  enchantFill,
  glow,
  groundShadow,
  ink,
  jointLimb,
  limb,
  linGrad,
  metalShape,
  poly,
  radGrad,
  spike,
  toonEye
} from './shapes';
import type { Rarity } from '../game/types';

type Ctx = CanvasRenderingContext2D;

/* ================================================================ families = */

export type WeaponFamily =
  | 'fist'
  | 'dagger'
  | 'sword'
  | 'greatsword'
  | 'katana'
  | 'rapier'
  | 'cutlass'
  | 'axe'
  | 'greataxe'
  | 'hammer'
  | 'maul'
  | 'pick'
  | 'spear'
  | 'trident'
  | 'glaive'
  | 'lance'
  | 'staff'
  | 'sceptre'
  | 'wand'
  | 'scythe'
  | 'bow'
  | 'claws'
  | 'gauntlet'
  | 'flail'
  | 'chakram';

const WEAPON_MAP: Record<string, WeaponFamily> = {
  w_fists: 'fist',
  w_dagger: 'dagger',
  w_shortsword: 'sword',
  w_axe: 'axe',
  w_spear: 'spear',
  w_hammer: 'hammer',
  w_bow: 'bow',
  w_claws: 'claws',
  w_scythe: 'scythe',
  w_blade: 'greatsword',
  w_staff: 'staff',
  w_gauntlet: 'gauntlet',
  w_flail: 'flail',
  w_katana: 'katana',
  w_trident: 'trident',
  w_warpick: 'pick',
  w_chakram: 'chakram',
  w_glaive: 'glaive',
  w_wand: 'wand',
  w_cutlass: 'cutlass',
  w_maul: 'maul',
  w_rapier: 'rapier',
  w_greataxe: 'greataxe',
  w_voidblade: 'greatsword',
  w_sceptre: 'sceptre',
  w_lance: 'lance',
  w_reaper: 'scythe',
  w_starforge: 'greatsword'
};

const WEAPON_KEYWORDS: [string, WeaponFamily][] = [
  ['dagger', 'dagger'], ['knife', 'dagger'], ['shiv', 'dagger'],
  ['katana', 'katana'], ['rapier', 'rapier'], ['cutlass', 'cutlass'], ['sabre', 'cutlass'],
  ['greatsword', 'greatsword'], ['greatblade', 'greatsword'], ['blade', 'greatsword'],
  ['sword', 'sword'], ['edge', 'greatsword'],
  ['greataxe', 'greataxe'], ['axe', 'axe'], ['cleaver', 'greataxe'],
  ['maul', 'maul'], ['hammer', 'hammer'], ['pick', 'pick'],
  ['trident', 'trident'], ['glaive', 'glaive'], ['halberd', 'glaive'], ['lance', 'lance'],
  ['spear', 'spear'], ['pike', 'spear'],
  ['sceptre', 'sceptre'], ['scepter', 'sceptre'], ['staff', 'staff'], ['wand', 'wand'], ['rod', 'wand'],
  ['scythe', 'scythe'], ['reaper', 'scythe'],
  ['bow', 'bow'], ['claw', 'claws'], ['talon', 'claws'],
  ['gauntlet', 'gauntlet'], ['fist', 'fist'], ['knuckle', 'gauntlet'],
  ['flail', 'flail'], ['chain', 'flail'], ['chakram', 'chakram'], ['disc', 'chakram']
];

export function weaponFamily(id: string | null): WeaponFamily | null {
  if (!id) return null;
  const direct = WEAPON_MAP[id];
  if (direct) return direct;
  for (const [k, fam] of WEAPON_KEYWORDS) if (id.includes(k)) return fam;
  return 'sword';
}

export type ArmorClass = 'cloth' | 'leather' | 'mail' | 'plate' | 'scale';

interface ArmorStyle {
  cls: ArmorClass;
  tone: string;
  cape: boolean;
  pauldrons: number; // 0 none, 1 small, 2 heavy
  skirt: boolean;
  metal: number;
}

const ARMOR_TONE: Record<string, string> = {
  a_rags: '#8d7f6d',
  a_leather: '#7a4f31',
  a_chain: '#8d97ae',
  a_plate: '#aab6d0',
  a_scale: '#4e8b6a',
  a_robe: '#4a4f8c',
  a_cloak: '#2e3350',
  a_bulwark: '#96a3c4',
  a_vitalvest: '#8c4a4a',
  a_dragonhide: '#7a5230',
  a_stoneskin: '#79808f',
  a_soulguard: '#4c6f8a',
  a_warplate: '#9aa5c2',
  a_ironhide: '#6b5340',
  a_runeplate: '#6d84c4',
  a_wraithweave: '#3b3050',
  a_ancestral: '#6a5a86',
  a_bastion: '#a3aec8',
  a_frostguard: '#8fc4dc',
  a_dragonscale: '#3f7f5e',
  a_voidplate: '#2b2740',
  a_titanguard: '#8a8f9c',
  a_phoenixplate: '#c2603a',
  a_celestial: '#d8d2b8',
  a_shadowplate: '#26283c',
  a_ironwill: '#7d8698',
  a_stormguard: '#6f86b8',
  a_worldshell: '#5f7d5a'
};

const HEAVY = /plate|bulwark|guard|titan|bastion|warplate|worldshell|juggernaut|aegis/;
const MAIL = /chain|mail|hauberk|scale|ironhide|jerkin/;
const CLOTHY = /rag|robe|vest|weave|vestment|cloak|silk|shroud/;
const LEATHERY = /leather|hide|hood|fur/;

function armorStyle(id: string | null, rarity: Rarity | null): ArmorStyle {
  if (!id) {
    return { cls: 'cloth', tone: '#6b6350', cape: false, pauldrons: 0, skirt: false, metal: 0.1 };
  }
  const tone = ARMOR_TONE[id] ?? (HEAVY.test(id) ? '#9aa5c2' : LEATHERY.test(id) ? LEATHER : CLOTH);
  let cls: ArmorClass = 'leather';
  if (HEAVY.test(id)) cls = 'plate';
  else if (/scale|dragonscale|dragonhide/.test(id)) cls = 'scale';
  else if (MAIL.test(id)) cls = 'mail';
  else if (CLOTHY.test(id)) cls = 'cloth';
  else if (LEATHERY.test(id)) cls = 'leather';
  const legendary = rarity === 'legendary' || rarity === 'mythic' || rarity === 'epic';
  return {
    cls,
    tone,
    cape: /cloak|weave|vestment|celestial|shadow|ancestral|soulguard|phoenix/.test(id) || (legendary && cls === 'plate'),
    pauldrons: cls === 'plate' ? 2 : cls === 'mail' || cls === 'scale' ? 1 : legendary ? 1 : 0,
    skirt: cls === 'cloth' || /robe|vestment|weave/.test(id),
    metal: cls === 'plate' ? 0.95 : cls === 'mail' ? 0.8 : cls === 'scale' ? 0.6 : cls === 'leather' ? 0.25 : 0.1
  };
}

export type HelmType = 'none' | 'circlet' | 'cap' | 'hood' | 'horned' | 'great' | 'crown';

function helmType(id: string | null): HelmType {
  if (!id) return 'none';
  if (/crown|diadem|king/.test(id)) return 'crown';
  if (/hood|cowl|shroud|veil/.test(id)) return 'hood';
  if (/horn|dragon|demon|beast/.test(id)) return 'horned';
  if (/great|full|plate|titan|visor|knight|bastion|war/.test(id)) return 'great';
  if (/circlet|band|tiara|halo|rune/.test(id)) return 'circlet';
  return 'cap';
}

export type OffhandType = 'none' | 'buckler' | 'kite' | 'tower' | 'orb' | 'tome' | 'torch' | 'dagger';

function offhandType(id: string | null): OffhandType {
  if (!id) return 'none';
  if (/tower|bulwark|greatshield/.test(id)) return 'tower';
  if (/buckler|targe/.test(id)) return 'buckler';
  if (/orb|sphere|focus|crystal/.test(id)) return 'orb';
  if (/tome|book|grimoire|codex/.test(id)) return 'tome';
  if (/torch|lantern|brand/.test(id)) return 'torch';
  if (/dagger|parry|knife/.test(id)) return 'dagger';
  return 'kite';
}

/* ==================================================================== rig == */

interface Joint {
  x: number;
  y: number;
}

interface Limb2 {
  a: Joint;
  b: Joint;
  c: Joint;
  /** direction of the lower segment, radians, 0 = +x */
  angle: number;
}

interface Rig {
  hipY: number;
  chestY: number;
  lean: number;
  bob: number;
  squash: number;
  offX: number;
  legBack: Limb2;
  legFront: Limb2;
  armBack: Limb2;
  armFront: Limb2;
  headX: number;
  headY: number;
  headTilt: number;
  weaponRot: number;
  crouch: number;
  eyeSquint: number;
}

const THIGH = 23;
const SHIN = 22;
const UPPER = 17;
const FORE = 16;

function fk2(
  ox: number,
  oy: number,
  a1: number,
  a2: number,
  l1: number,
  l2: number
): Limb2 {
  const bx = ox + Math.sin(a1) * l1;
  const by = oy + Math.cos(a1) * l1;
  const total = a1 + a2;
  const cx = bx + Math.sin(total) * l2;
  const cy = by + Math.cos(total) * l2;
  return { a: { x: ox, y: oy }, b: { x: bx, y: by }, c: { x: cx, y: cy }, angle: Math.atan2(cy - by, cx - bx) };
}

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;

/** What the hero guards with in the 'defend' pose. */
export type GuardStyle = 'shield' | 'weapon';

function buildRig(pose: HeroPose, t: number, guard: GuardStyle = 'weapon'): Rig {
  const hipY = -48;
  const chestY = -78;
  let lean = 0;
  let bob = 0;
  let squash = 1;
  let offX = 0;
  let crouch = 0;
  let headTilt = 0;
  let weaponRot = 0;
  let eyeSquint = 0;

  // defaults (idle)
  let legBackA = 0.16;
  let legBackK = -0.08;
  let legFrontA = -0.14;
  let legFrontK = 0.12;
  let armBackA = 0.24;
  let armBackK = 0.5;
  let armFrontA = -0.18;
  let armFrontK = 0.62;

  if (pose === 'run') {
    const p = t * 10.5;
    const s = Math.sin(p);
    const s2 = Math.sin(p + Math.PI);
    legBackA = s * 0.86;
    legFrontA = s2 * 0.86;
    legBackK = -clamp(Math.sin(p - 1.1), 0, 1) * 1.15 - 0.1;
    legFrontK = -clamp(Math.sin(p + Math.PI - 1.1), 0, 1) * 1.15 - 0.1;
    armBackA = -s * 1.0;
    armFrontA = -s2 * 1.0;
    armBackK = 0.75 + clamp(s, 0, 1) * 0.5;
    armFrontK = 0.75 + clamp(s2, 0, 1) * 0.5;
    bob = -Math.abs(Math.sin(p)) * 3.4 - 1.2;
    squash = 1 + Math.sin(p * 2) * 0.035;
    lean = 0.13 + Math.sin(p * 2) * 0.02;
    headTilt = -0.06;
  } else if (pose === 'idle') {
    const b = Math.sin(t * 2.1);
    bob = b * 1.4;
    squash = 1 + b * 0.02;
    armBackA = 0.24 + b * 0.07;
    armFrontA = -0.18 - b * 0.07;
    lean = 0.02 + b * 0.012;
    headTilt = b * 0.04;
    legBackA = 0.16;
    legFrontA = -0.12;
  } else if (pose === 'attack') {
    const q = (t % 0.72) / 0.72;
    if (q < 0.42) {
      const k = easeOut(q / 0.42);
      lean = -0.26 * k;
      offX = -5 * k;
      armFrontA = -0.18 - 2.5 * k;
      armFrontK = 0.62 - 0.5 * k;
      weaponRot = -0.7 * k;
      legBackA = 0.16 + 0.3 * k;
      legFrontA = -0.14 - 0.18 * k;
      crouch = 2 * k;
      eyeSquint = 0.3 * k;
    } else if (q < 0.58) {
      // The strike: a committed forward thrust. The weapon arm straightens
      // out level with the shoulder, the body drives forward, the back foot
      // stays planted behind and the front knee bends into the lunge.
      const k = easeIn((q - 0.42) / 0.16);
      lean = -0.26 + 0.7 * k;
      offX = -5 + 21 * k;
      armFrontA = -2.68 + 4.1 * k;
      armFrontK = 0.12 - 0.02 * k;
      weaponRot = -0.7 + 0.85 * k;
      legBackA = 0.46 - 1.0 * k;
      legBackK = -0.08 + 0.1 * k;
      legFrontA = -0.32 + 0.9 * k;
      legFrontK = 0.12 + 0.5 * k;
      crouch = 2 + 2 * k;
      eyeSquint = 0.3 + 0.5 * k;
    } else {
      // Hold the extension for a beat, then recover to the ready stance.
      const k = easeOut(clamp(((q - 0.58) / 0.42 - 0.25) / 0.75, 0, 1));
      lean = 0.44 - 0.42 * k;
      offX = 16 - 16 * k;
      armFrontA = 1.42 - 1.6 * k;
      armFrontK = 0.1 + 0.52 * k;
      weaponRot = 0.15 - 0.15 * k;
      legBackA = -0.54 + 0.7 * k;
      legBackK = 0.02 - 0.1 * k;
      legFrontA = 0.58 - 0.72 * k;
      legFrontK = 0.62 - 0.5 * k;
      crouch = 4 - 4 * k;
      eyeSquint = 0.8 - 0.8 * k;
    }
    armBackA = 0.4 - lean * 0.6;
    armBackK = 0.8;
    bob = -Math.abs(lean) * 3;
    headTilt = lean * 0.4;
  } else if (pose === 'cast') {
    const b = Math.sin(t * 3.4);
    bob = -3 + b * 1.8;
    lean = -0.08;
    armFrontA = -2.5 + b * 0.12;
    armFrontK = 0.35;
    armBackA = -1.5 - b * 0.1;
    armBackK = 0.9;
    legBackA = 0.22;
    legFrontA = -0.2;
    headTilt = -0.14;
    squash = 1.03;
  } else if (pose === 'hurt') {
    const k = clamp(1 - (t % 0.5) / 0.5, 0, 1);
    lean = -0.34 * k;
    offX = -9 * k;
    bob = -2 * k;
    crouch = 5 * k;
    armFrontA = -0.18 + 1.1 * k;
    armBackA = 0.24 + 1.2 * k;
    armFrontK = 1.1;
    armBackK = 1.1;
    legBackA = 0.16 + 0.35 * k;
    legFrontA = -0.14 - 0.35 * k;
    headTilt = -0.4 * k;
    eyeSquint = 0.9 * k;
    squash = 1 - 0.05 * k;
  } else if (pose === 'victory') {
    const p = t * 4.4;
    const jump = Math.max(0, Math.sin(p));
    bob = -jump * 9;
    squash = 1 + jump * 0.08 - (1 - jump) * 0.04;
    armFrontA = -2.75 - jump * 0.25;
    armFrontK = 0.15;
    armBackA = -2.5 - jump * 0.2;
    armBackK = 0.3;
    legBackA = 0.2 + jump * 0.5;
    legFrontA = -0.2 - jump * 0.5;
    legBackK = -jump * 0.9;
    legFrontK = -jump * 0.5;
    headTilt = -0.1;
    lean = -0.05;
  } else if (pose === 'defend') {
    const b = Math.sin(t * 3.2);
    crouch = 6;
    bob = 1 + b * 0.7;
    legBackA = 0.42;
    legFrontA = -0.34;
    legBackK = -0.35;
    legFrontK = -0.3;
    headTilt = 0.1;
    eyeSquint = 0.45;
    if (guard === 'shield') {
      // Shield arm punches forward and up so the shield sits squarely in
      // front of the chest; the weapon hand tucks back, low and ready.
      lean = -0.1;
      armBackA = 1.25 + b * 0.03;
      armBackK = 1.05;
      armFrontA = -0.55;
      armFrontK = 0.9;
      weaponRot = -0.5;
    } else {
      // No shield: the weapon is held across the body, blade up over the far
      // shoulder, the free hand up as a fist in front.
      lean = -0.14;
      armFrontA = 0.5 + b * 0.03;
      armFrontK = 2.0;
      weaponRot = -1.57;
      armBackA = 0.6;
      armBackK = 0.9;
    }
  }

  const hy = hipY + crouch + bob;
  const cy = chestY + crouch * 0.6 + bob;
  const legBack = fk2(-4.5, hy, legBackA, legBackK, THIGH - crouch * 0.25, SHIN - crouch * 0.25);
  const legFront = fk2(4.5, hy, legFrontA, legFrontK, THIGH - crouch * 0.25, SHIN - crouch * 0.25);
  const shX = Math.sin(lean) * 10;
  const armBack = fk2(-8 + shX, cy, armBackA + lean, armBackK, UPPER, FORE);
  const armFront = fk2(7 + shX, cy, armFrontA + lean, armFrontK, UPPER, FORE);

  return {
    hipY: hy,
    chestY: cy,
    lean,
    bob,
    squash,
    offX,
    legBack,
    legFront,
    armBack,
    armFront,
    headX: shX * 1.35,
    headY: cy - 14,
    headTilt: headTilt + lean * 0.5,
    weaponRot,
    crouch,
    eyeSquint
  };
}

/* ============================================================== equipment == */

function drawBoot(c: Ctx, l: Limb2, mat: Material, style: ArmorStyle, bootId: string | null) {
  const heavy = !!bootId && /plate|greave|iron|steel|sabaton|titan|guard/.test(bootId);
  const w = heavy ? 12 : 10;
  const dir = l.angle;
  const fx = l.c.x;
  const fy = l.c.y;
  // shin guard
  c.save();
  c.translate(fx, fy);
  c.rotate(dir - Math.PI / 2);
  c.fillStyle = linGrad(c, -w, -10, w, 6, [
    [0, mat.hi],
    [0.5, mat.base],
    [1, mat.lo]
  ]);
  c.beginPath();
  c.roundRect(-w * 0.55, -12, w * 1.1, 13, 4);
  c.fill();
  ink(c, 1.3);
  // foot
  c.fillStyle = linGrad(c, -w, 0, w, 5, [
    [0, mat.base],
    [1, mat.lo]
  ]);
  c.beginPath();
  c.moveTo(-w * 0.55, -1);
  c.lineTo(w * 0.55, -1);
  c.lineTo(w * 0.75, 3.2);
  c.quadraticCurveTo(w * 0.4, 5, -w * 0.7, 4.6);
  c.quadraticCurveTo(-w * 1.0, 3.5, -w * 0.9, 0.6);
  c.closePath();
  c.fill();
  ink(c, 1.3);
  if (heavy) {
    c.fillStyle = alpha(mat.spec, 0.5);
    c.fillRect(-w * 0.5, -10, w, 1.6);
  }
  c.restore();
  if (mat.emissive > 0.4) enchantFill(c, mat, fx, fy - 3, 12);
  void style;
}

function drawLegs(c: Ctx, rig: Rig, style: ArmorStyle, bootMat: Material, bootId: string | null, back: boolean) {
  const l = back ? rig.legBack : rig.legFront;
  const clothTone = style.cls === 'cloth' ? style.tone : mix(style.tone, '#2a2436', 0.55);
  const fill = linGrad(c, l.a.x - 8, l.a.y, l.a.x + 8, l.c.y, [
    [0, lighten(clothTone, back ? 0.02 : 0.16)],
    [1, darken(clothTone, back ? 0.42 : 0.2)]
  ]);
  jointLimb(c, l.a.x, l.a.y, l.b.x, l.b.y, l.c.x, l.c.y, 11.5, 8.6, 6.6, fill);
  const bm = back ? material(darken(bootMat.base, 0.3), null, bootMat.metal) : bootMat;
  drawBoot(c, l, bm, style, bootId);
}

function drawArm(
  c: Ctx,
  l: Limb2,
  style: ArmorStyle,
  mat: Material,
  back: boolean,
  glovedTone: string
) {
  const tone = back ? darken(style.tone, 0.34) : style.tone;
  const fill = linGrad(c, l.a.x - 7, l.a.y, l.a.x + 7, l.c.y, [
    [0, lighten(tone, back ? 0.0 : 0.18)],
    [1, darken(tone, back ? 0.4 : 0.22)]
  ]);
  jointLimb(c, l.a.x, l.a.y, l.b.x, l.b.y, l.c.x, l.c.y, 9.6, 7.4, 6.2, fill);
  // hand / glove
  c.fillStyle = back ? darken(glovedTone, 0.32) : glovedTone;
  c.beginPath();
  c.arc(l.c.x, l.c.y, 4.4, 0, TAU);
  c.fill();
  ink(c, 1.2);
  void mat;
}

function drawPauldron(c: Ctx, x: number, y: number, mat: Material, size: number, heavy: boolean) {
  c.save();
  c.translate(x, y);
  c.beginPath();
  if (heavy) {
    c.moveTo(-size * 1.05, size * 0.35);
    c.quadraticCurveTo(-size * 1.15, -size * 0.85, 0, -size * 0.95);
    c.quadraticCurveTo(size * 1.15, -size * 0.85, size * 1.05, size * 0.35);
    c.quadraticCurveTo(size * 0.4, size * 0.75, 0, size * 0.7);
    c.quadraticCurveTo(-size * 0.4, size * 0.75, -size * 1.05, size * 0.35);
  } else {
    c.ellipse(0, 0, size, size * 0.85, 0, 0, TAU);
  }
  c.closePath();
  metalShape(c, mat, -size, -size, size, size, 1.5);
  c.fillStyle = alpha(mat.spec, 0.45);
  c.beginPath();
  c.ellipse(-size * 0.3, -size * 0.35, size * 0.42, size * 0.22, -0.5, 0, TAU);
  c.fill();
  if (heavy) {
    c.strokeStyle = alpha(mat.accent, 0.7);
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(-size * 0.95, size * 0.25);
    c.quadraticCurveTo(0, size * 0.6, size * 0.95, size * 0.25);
    c.stroke();
  }
  c.restore();
  enchantFill(c, mat, x, y, size * 2.6);
}

function drawTorso(c: Ctx, rig: Rig, style: ArmorStyle, mat: Material) {
  const cy = rig.chestY;
  const hy = rig.hipY;
  c.save();
  c.translate(0, cy);
  c.rotate(rig.lean);
  c.translate(0, -cy);
  const top = cy - 6;
  const bottom = hy + 4;

  // torso silhouette: broad chest tapering to waist then flaring at hips
  c.beginPath();
  c.moveTo(-13.5, top + 3);
  c.quadraticCurveTo(-15.5, top + 14, -9.5, cy + 20);
  c.quadraticCurveTo(-11.5, bottom - 2, -9, bottom);
  c.lineTo(9, bottom);
  c.quadraticCurveTo(11.5, bottom - 2, 9.5, cy + 20);
  c.quadraticCurveTo(15.5, top + 14, 13.5, top + 3);
  c.quadraticCurveTo(6, top - 3, 0, top - 2.5);
  c.quadraticCurveTo(-6, top - 3, -13.5, top + 3);
  c.closePath();
  c.fillStyle = linGrad(c, -14, top, 14, bottom, [
    [0, lighten(mat.base, 0.3)],
    [0.34, mat.hi],
    [0.6, mat.base],
    [1, mat.lo]
  ]);
  c.fill();
  ink(c, 1.9);

  // chest detail per armour class
  if (style.cls === 'plate') {
    c.strokeStyle = alpha(darken(mat.lo, 0.3), 0.8);
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(0, top - 1);
    c.lineTo(0, cy + 22);
    c.stroke();
    c.beginPath();
    c.moveTo(-12, cy + 8);
    c.quadraticCurveTo(0, cy + 13, 12, cy + 8);
    c.stroke();
    c.fillStyle = alpha(mat.spec, 0.32);
    c.beginPath();
    c.ellipse(-6, cy + 4, 4.5, 9, 0.25, 0, TAU);
    c.fill();
  } else if (style.cls === 'mail') {
    c.save();
    c.beginPath();
    c.rect(-14, top, 28, bottom - top);
    c.clip();
    c.strokeStyle = alpha(darken(mat.base, 0.45), 0.55);
    c.lineWidth = 1;
    for (let yy = top + 4; yy < bottom; yy += 4) {
      c.beginPath();
      for (let xx = -14; xx < 14; xx += 4) {
        c.moveTo(xx, yy);
        c.arc(xx + 2, yy, 2, Math.PI, TAU);
      }
      c.stroke();
    }
    c.restore();
  } else if (style.cls === 'scale') {
    c.save();
    c.beginPath();
    c.rect(-14, top, 28, bottom - top);
    c.clip();
    c.fillStyle = alpha(lighten(mat.base, 0.22), 0.6);
    for (let yy = top + 5, row = 0; yy < bottom; yy += 5, row++) {
      for (let xx = -14 + (row % 2) * 3; xx < 14; xx += 6) {
        c.beginPath();
        c.arc(xx, yy, 2.7, Math.PI, TAU);
        c.fill();
      }
    }
    c.restore();
  } else if (style.cls === 'leather') {
    c.strokeStyle = alpha(darken(mat.lo, 0.2), 0.75);
    c.lineWidth = 2.4;
    c.beginPath();
    c.moveTo(-11, top + 6);
    c.lineTo(9, cy + 24);
    c.stroke();
    c.fillStyle = alpha(GOLD, 0.55);
    c.beginPath();
    c.arc(-2, cy + 14, 2.2, 0, TAU);
    c.fill();
  } else {
    // cloth: folds
    c.strokeStyle = alpha(darken(mat.lo, 0.2), 0.5);
    c.lineWidth = 1.4;
    for (const dx of [-6, 0, 6]) {
      c.beginPath();
      c.moveTo(dx, top + 6);
      c.quadraticCurveTo(dx + 2, cy + 16, dx - 1, bottom - 2);
      c.stroke();
    }
  }

  // belt
  const beltTone = style.cls === 'cloth' ? '#7a4f31' : darken(mat.base, 0.45);
  c.fillStyle = linGrad(c, 0, hy - 4, 0, hy + 4, [
    [0, lighten(beltTone, 0.2)],
    [1, darken(beltTone, 0.25)]
  ]);
  c.beginPath();
  c.roundRect(-10.5, hy - 3.5, 21, 7.5, 2.5);
  c.fill();
  ink(c, 1.3);
  c.fillStyle = mat.emissive > 0.3 ? mat.accent : GOLD;
  c.beginPath();
  c.roundRect(-3.2, hy - 2.6, 6.4, 5.6, 1.6);
  c.fill();
  ink(c, 1);

  // rim light down the front edge
  c.strokeStyle = alpha(mat.spec, 0.55);
  c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(12.6, top + 5);
  c.quadraticCurveTo(9.6, cy + 16, 9, bottom - 3);
  c.stroke();

  if (mat.emissive > 0.2 && mat.glow) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = alpha(mat.glow, 0.4 * mat.emissive + 0.2);
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(-8, cy + 6);
    c.lineTo(-3, cy + 12);
    c.lineTo(-8, cy + 18);
    c.moveTo(8, cy + 6);
    c.lineTo(3, cy + 12);
    c.lineTo(8, cy + 18);
    c.stroke();
    c.restore();
  }
  c.restore();
}

function drawCape(c: Ctx, rig: Rig, mat: Material, t: number, pose: HeroPose) {
  const flow = pose === 'run' ? 1 : pose === 'attack' ? 0.5 : 0.22;
  const w = Math.sin(t * 4.2) * 3 * flow;
  const top = rig.chestY - 5;
  const len = 52;
  c.save();
  c.beginPath();
  c.moveTo(-11, top);
  c.quadraticCurveTo(-24 - flow * 10 + w, top + len * 0.45, -20 - flow * 16 + w * 2, top + len);
  c.quadraticCurveTo(-6, top + len + 5, 4, top + len - 6);
  c.quadraticCurveTo(9, top + len * 0.4, 8, top);
  c.closePath();
  c.fillStyle = linGrad(c, -24, top, 8, top + len, [
    [0, mat.base],
    [0.55, darken(mat.base, 0.3)],
    [1, darken(mat.lo, 0.15)]
  ]);
  c.fill();
  ink(c, 1.6);
  c.strokeStyle = alpha(mat.accent, 0.45);
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(-14, top + 8);
  c.quadraticCurveTo(-20 + w, top + len * 0.6, -16 + w * 2, top + len - 4);
  c.stroke();
  c.restore();
}

function drawHead(c: Ctx, rig: Rig, look: HeroLook, pose: HeroPose, t: number) {
  const hx = rig.headX;
  const hy = rig.headY;
  const helm = helmType(look.helmId);
  const helmMat = material(
    look.helmId && ARMOR_TONE[look.helmId] ? ARMOR_TONE[look.helmId] : helm === 'hood' ? '#3a3550' : STEEL,
    look.helmRarity,
    helm === 'hood' ? 0.15 : 0.9
  );
  c.save();
  c.translate(hx, hy);
  c.rotate(rig.headTilt);

  // neck
  c.fillStyle = SKIN_DARK;
  c.beginPath();
  c.roundRect(-3.6, 5, 7.2, 8, 2);
  c.fill();

  // skull
  c.beginPath();
  c.moveTo(-9.4, -1);
  c.quadraticCurveTo(-9.8, -11, 0, -11.6);
  c.quadraticCurveTo(9.6, -11, 9.6, -1);
  c.quadraticCurveTo(9.8, 6.4, 3.4, 8.6);
  c.quadraticCurveTo(0, 9.6, -3, 8.2);
  c.quadraticCurveTo(-9.2, 6, -9.4, -1);
  c.closePath();
  c.fillStyle = radGrad(c, -3, -5, 1, 0, 0, 15, [
    [0, lighten(SKIN, 0.2)],
    [0.55, SKIN],
    [1, SKIN_MID]
  ]);
  c.fill();
  ink(c, 1.5);

  // jaw shadow
  c.fillStyle = alpha(SKIN_DARK, 0.35);
  c.beginPath();
  c.ellipse(1.5, 5.5, 7, 3.4, 0, 0, Math.PI);
  c.fill();

  // ear
  c.fillStyle = SKIN_MID;
  c.beginPath();
  c.ellipse(-7.6, 1.4, 2.2, 3, 0.2, 0, TAU);
  c.fill();

  // hair (hidden under full helms)
  if (helm !== 'great' && helm !== 'hood') {
    c.fillStyle = linGrad(c, 0, -13, 0, 0, [
      [0, lighten(HAIR, 0.28)],
      [1, HAIR]
    ]);
    c.beginPath();
    c.moveTo(-9.6, -1.5);
    c.quadraticCurveTo(-11.2, -13, 0, -13.2);
    c.quadraticCurveTo(11, -13, 9.8, -1.5);
    c.quadraticCurveTo(8, -6.5, 3.5, -7.4);
    c.quadraticCurveTo(-3, -8.6, -7, -4.2);
    c.quadraticCurveTo(-8.6, -2.6, -9.6, -1.5);
    c.closePath();
    c.fill();
    ink(c, 1.1);
    // side lock
    c.beginPath();
    c.moveTo(-9.2, -3);
    c.quadraticCurveTo(-12.4, 1, -9.6, 5.4);
    c.quadraticCurveTo(-7.6, 1.6, -8.2, -2.4);
    c.closePath();
    c.fill();
  }

  // face
  const squint = rig.eyeSquint;
  const blink = pose === 'idle' && Math.sin(t * 1.7) > 0.985 ? 1 : 0;
  const angry = pose === 'attack' ? 1 : pose === 'defend' ? 0.6 : 0.25;
  if (helm !== 'great') {
    toonEye(c, 2.4, 0.4, 2.5 * (1 - squint * 0.45) * (1 - blink), 1, angry);
    toonEye(c, 7.4, 0.6, 2.2 * (1 - squint * 0.45) * (1 - blink), 1, angry);
    // brow
    c.strokeStyle = alpha(SKIN_DARK, 0.5);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(8.4, 3.4);
    c.quadraticCurveTo(9.6, 4.4, 8.6, 5.2);
    c.stroke();
    // mouth
    c.strokeStyle = 'rgba(80,38,38,0.75)';
    c.lineWidth = 1.4;
    c.lineCap = 'round';
    c.beginPath();
    if (pose === 'victory') c.arc(4.6, 4.4, 2.6, 0.15, Math.PI - 0.15);
    else if (pose === 'hurt') c.arc(4.6, 6.6, 2.4, Math.PI + 0.2, TAU - 0.2);
    else {
      c.moveTo(3, 5.6);
      c.lineTo(6.6, 5.4);
    }
    c.stroke();
  }

  // helm
  if (helm !== 'none') drawHelm(c, helm, helmMat, t);
  c.restore();
}

function drawHelm(c: Ctx, type: HelmType, mat: Material, t: number) {
  if (type === 'hood') {
    c.beginPath();
    c.moveTo(-11, 4);
    c.quadraticCurveTo(-13, -14, 0, -14.5);
    c.quadraticCurveTo(13, -14, 11.5, 2);
    c.quadraticCurveTo(9, -2, 5, -3.5);
    c.quadraticCurveTo(2, -6, -2, -5);
    c.quadraticCurveTo(-7, -3, -9, 5);
    c.closePath();
    c.fillStyle = linGrad(c, -12, -14, 10, 6, [
      [0, mat.hi],
      [0.6, mat.base],
      [1, mat.lo]
    ]);
    c.fill();
    ink(c, 1.5);
    c.fillStyle = 'rgba(6,8,16,0.55)';
    c.beginPath();
    c.ellipse(3.5, -1, 7.5, 5.5, 0, 0, TAU);
    c.fill();
    c.fillStyle = alpha(mat.glow || '#8fd8ff', 0.9);
    c.beginPath();
    c.arc(3.4, 0.2, 1.5, 0, TAU);
    c.arc(7.4, 0.6, 1.3, 0, TAU);
    c.fill();
    glow(c, 5.4, 0.4, 8, mat.glow || '#8fd8ff', 0.4);
    return;
  }
  if (type === 'crown') {
    c.fillStyle = linGrad(c, -10, -18, 10, -8, [
      [0, lighten(GOLD, 0.4)],
      [0.5, GOLD],
      [1, darken(GOLD, 0.3)]
    ]);
    poly(c, [-9.4, -9, -9.4, -16, -6, -12, -3, -18, 0, -12.5, 3, -18, 6, -12, 9.4, -16, 9.4, -9]);
    c.fill();
    ink(c, 1.3);
    c.fillStyle = mat.accent;
    for (const gx of [-6, 0, 6]) {
      c.beginPath();
      c.arc(gx, -11, 1.4, 0, TAU);
      c.fill();
    }
    glow(c, 0, -13, 16, mat.glow || GOLD, 0.5);
    return;
  }
  if (type === 'circlet') {
    c.fillStyle = linGrad(c, -10, -10, 10, -5, [
      [0, mat.hi],
      [1, mat.lo]
    ]);
    c.beginPath();
    c.roundRect(-10, -10.5, 20, 3.6, 1.8);
    c.fill();
    ink(c, 1);
    c.fillStyle = mat.accent;
    c.beginPath();
    c.moveTo(6.5, -8.6);
    c.lineTo(8.6, -13);
    c.lineTo(10.6, -8.6);
    c.closePath();
    c.fill();
    glow(c, 8.6, -11, 9, mat.glow || mat.accent, 0.45 + Math.sin(t * 3) * 0.1);
    return;
  }
  // cap / horned / great share a dome
  c.beginPath();
  c.moveTo(-10.4, -0.5);
  c.quadraticCurveTo(-11.4, -13.5, 0, -14);
  c.quadraticCurveTo(11.4, -13.5, 10.6, -0.5);
  c.lineTo(-10.4, -0.5);
  c.closePath();
  metalShape(c, mat, -11, -14, 11, 2, 1.6);
  // brow band
  c.fillStyle = linGrad(c, 0, -3, 0, 1.6, [
    [0, mat.spec],
    [1, mat.lo]
  ]);
  c.beginPath();
  c.roundRect(-10.8, -3.2, 21.6, 4.4, 1.6);
  c.fill();
  ink(c, 1.2);

  if (type === 'great') {
    // face plate with a visor slit
    c.fillStyle = linGrad(c, -8, -2, 10, 9, [
      [0, mat.base],
      [1, mat.lo]
    ]);
    c.beginPath();
    c.moveTo(-9.4, 0.5);
    c.quadraticCurveTo(-9, 7.5, -2, 9.4);
    c.quadraticCurveTo(4, 10.6, 9.4, 6.5);
    c.lineTo(10.2, 0.5);
    c.closePath();
    c.fill();
    ink(c, 1.4);
    c.fillStyle = '#080a14';
    c.beginPath();
    c.roundRect(-2, 1.4, 11.6, 2.8, 1.2);
    c.fill();
    c.fillStyle = alpha(mat.glow || '#ff8a5c', 0.9);
    c.beginPath();
    c.roundRect(2.4, 2, 6.4, 1.6, 0.8);
    c.fill();
    glow(c, 6, 2.6, 9, mat.glow || '#ff8a5c', 0.5);
    // crest
    c.fillStyle = mat.accent;
    c.beginPath();
    c.moveTo(-1, -14.2);
    c.quadraticCurveTo(0, -20, 4, -18.5);
    c.quadraticCurveTo(2, -15.5, 2.4, -13.6);
    c.closePath();
    c.fill();
  }
  if (type === 'horned') {
    c.fillStyle = linGrad(c, -14, -22, 14, -6, [
      [0, lighten(BONE, 0.2)],
      [1, darken(BONE, 0.35)]
    ]);
    spike(c, -8.4, -8, 15, 5.5, -2.5, 0.4);
    c.fill();
    ink(c, 1.2);
    spike(c, 8.4, -8, 15, 5.5, -0.64, -0.4);
    c.fill();
    ink(c, 1.2);
  }
  if (mat.emissive > 0.3) glow(c, 0, -6, 20, mat.glow || mat.accent, mat.emissive * 0.45);
}

/* ================================================================ weapons == */

function drawBlade(
  c: Ctx,
  mat: Material,
  len: number,
  width: number,
  curve: number,
  doubleEdge: boolean
) {
  const w = width / 2;
  c.beginPath();
  c.moveTo(-w, 0);
  c.quadraticCurveTo(-w - curve, -len * 0.55, -w * 0.35 - curve * 1.3, -len);
  c.quadraticCurveTo(0, -len - width * 0.55, w * 0.42 - curve * 0.6, -len * 0.97);
  c.quadraticCurveTo(w - curve * 0.2, -len * 0.5, w, 0);
  c.closePath();
  metalShape(c, mat, -w, -len, w, 0, 1.4);
  // fuller / highlight
  c.fillStyle = alpha(mat.spec, doubleEdge ? 0.5 : 0.6);
  c.beginPath();
  c.moveTo(-w * 0.25, -2);
  c.quadraticCurveTo(-w * 0.3 - curve, -len * 0.6, -w * 0.1 - curve, -len * 0.9);
  c.lineTo(w * 0.12 - curve, -len * 0.88);
  c.quadraticCurveTo(w * 0.16 - curve, -len * 0.55, w * 0.2, -2);
  c.closePath();
  c.fill();
  if (mat.emissive > 0) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.strokeStyle = alpha(mat.glow || mat.accent, 0.35 * mat.emissive + 0.15);
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(-w * 0.55, -3);
    c.quadraticCurveTo(-w * 0.6 - curve, -len * 0.6, -w * 0.3 - curve, -len * 0.95);
    c.stroke();
    c.restore();
    glow(c, -curve * 0.6, -len * 0.55, len * 0.5, mat.glow || mat.accent, mat.emissive * 0.4);
  }
}

function drawGrip(c: Ctx, mat: Material, len: number, guardW: number, pommel = true) {
  c.fillStyle = linGrad(c, -2, 0, 2.6, len, [
    [0, '#6b4a2c'],
    [1, '#3b2716']
  ]);
  c.beginPath();
  c.roundRect(-2.2, -1, 4.4, len, 2);
  c.fill();
  ink(c, 1);
  c.strokeStyle = 'rgba(20,12,6,0.6)';
  c.lineWidth = 0.8;
  for (let i = 2; i < len - 1; i += 2.6) {
    c.beginPath();
    c.moveTo(-2.2, i);
    c.lineTo(2.2, i - 1);
    c.stroke();
  }
  if (guardW > 0) {
    c.fillStyle = linGrad(c, -guardW, -3, guardW, 3, [
      [0, mat.hi],
      [0.5, mat.base],
      [1, mat.lo]
    ]);
    c.beginPath();
    c.moveTo(-guardW, 0.5);
    c.quadraticCurveTo(-guardW * 0.9, -3.4, 0, -3.2);
    c.quadraticCurveTo(guardW * 0.9, -3.4, guardW, 0.5);
    c.quadraticCurveTo(guardW * 0.5, 2.4, 0, 2.2);
    c.quadraticCurveTo(-guardW * 0.5, 2.4, -guardW, 0.5);
    c.closePath();
    c.fill();
    ink(c, 1.2);
  }
  if (pommel) {
    c.fillStyle = mat.emissive > 0.3 ? mat.accent : mat.base;
    c.beginPath();
    c.arc(0, len, 2.6, 0, TAU);
    c.fill();
    ink(c, 1);
  }
}

function drawHaft(c: Ctx, len: number, w = 3.4, tone = '#6b4a2c') {
  c.fillStyle = linGrad(c, -w, 0, w, 0, [
    [0, lighten(tone, 0.25)],
    [0.45, tone],
    [1, darken(tone, 0.35)]
  ]);
  c.beginPath();
  c.roundRect(-w / 2, -len, w, len + 6, w / 2);
  c.fill();
  ink(c, 1.1);
}

/** Draws the weapon with the grip at the origin, pointing up (-y). */
export function drawWeapon(c: Ctx, fam: WeaponFamily, mat: Material, t: number, charge = 0) {
  switch (fam) {
    case 'fist':
      return;
    case 'dagger':
      drawGrip(c, mat, 7, 4.5);
      c.save();
      c.translate(0, -1);
      drawBlade(c, mat, 17, 5, 0, false);
      c.restore();
      return;
    case 'sword':
      drawGrip(c, mat, 9, 8);
      c.save();
      c.translate(0, -2);
      drawBlade(c, mat, 32, 7.4, 0, true);
      c.restore();
      return;
    case 'greatsword':
      drawGrip(c, mat, 14, 12);
      c.save();
      c.translate(0, -3);
      drawBlade(c, mat, 46, 11.5, 0, true);
      c.restore();
      // side lugs
      c.fillStyle = mat.lo;
      c.beginPath();
      c.roundRect(-6.5, -14, 13, 3, 1.4);
      c.fill();
      return;
    case 'katana':
      drawGrip(c, mat, 12, 0);
      c.fillStyle = mat.lo;
      c.beginPath();
      c.ellipse(0, -1.5, 5.4, 1.9, 0, 0, TAU);
      c.fill();
      ink(c, 1);
      c.save();
      c.translate(0, -3);
      drawBlade(c, mat, 40, 5.6, 4.2, false);
      c.restore();
      return;
    case 'rapier':
      drawGrip(c, mat, 9, 0);
      c.strokeStyle = mat.base;
      c.lineWidth = 1.8;
      c.beginPath();
      c.arc(0, -3, 5.4, 0.1, Math.PI - 0.1);
      c.stroke();
      c.save();
      c.translate(0, -3);
      drawBlade(c, mat, 42, 3.4, 0, false);
      c.restore();
      return;
    case 'cutlass':
      drawGrip(c, mat, 9, 0);
      c.strokeStyle = mat.base;
      c.lineWidth = 2.4;
      c.beginPath();
      c.arc(4.5, 3, 6, -1.5, 1.3);
      c.stroke();
      c.save();
      c.translate(0, -2);
      drawBlade(c, mat, 30, 8.4, 5, false);
      c.restore();
      return;
    case 'axe':
    case 'greataxe': {
      const big = fam === 'greataxe';
      const len = big ? 42 : 30;
      drawHaft(c, len, big ? 4.4 : 3.6);
      const hy = -len + (big ? 10 : 7);
      const s = big ? 1.35 : 1;
      c.save();
      c.translate(0, hy);
      c.beginPath();
      c.moveTo(1.5, -9 * s);
      c.quadraticCurveTo(15 * s, -10 * s, 16 * s, 0);
      c.quadraticCurveTo(15 * s, 10 * s, 1.5, 9 * s);
      c.quadraticCurveTo(4 * s, 0, 1.5, -9 * s);
      c.closePath();
      metalShape(c, mat, 0, -10 * s, 16 * s, 10 * s, 1.5);
      if (big) {
        c.beginPath();
        c.moveTo(-1.5, -9 * s);
        c.quadraticCurveTo(-15 * s, -10 * s, -16 * s, 0);
        c.quadraticCurveTo(-15 * s, 10 * s, -1.5, 9 * s);
        c.quadraticCurveTo(-4 * s, 0, -1.5, -9 * s);
        c.closePath();
        metalShape(c, mat, -16 * s, -10 * s, 0, 10 * s, 1.5);
      }
      c.fillStyle = alpha(mat.spec, 0.45);
      c.beginPath();
      c.ellipse(9 * s, 0, 2.4, 6 * s, 0, 0, TAU);
      c.fill();
      enchantFill(c, mat, 0, 0, 26 * s);
      c.restore();
      return;
    }
    case 'hammer':
    case 'maul': {
      const big = fam === 'maul';
      const len = big ? 42 : 32;
      drawHaft(c, len, big ? 4.6 : 3.8);
      const s = big ? 1.4 : 1;
      c.save();
      c.translate(0, -len + 8 * s);
      c.beginPath();
      c.roundRect(-11 * s, -8 * s, 22 * s, 16 * s, 3);
      metalShape(c, mat, -11 * s, -8 * s, 11 * s, 8 * s, 1.6);
      c.fillStyle = alpha(mat.lo, 0.6);
      c.fillRect(-4 * s, -8 * s, 8 * s, 16 * s);
      c.fillStyle = alpha(mat.spec, 0.4);
      c.fillRect(-10 * s, -6.5 * s, 5 * s, 13 * s);
      enchantFill(c, mat, 0, 0, 26 * s);
      c.restore();
      return;
    }
    case 'pick': {
      drawHaft(c, 34, 3.8);
      c.save();
      c.translate(0, -26);
      c.beginPath();
      c.moveTo(-2, -4);
      c.quadraticCurveTo(10, -8, 19, -1);
      c.quadraticCurveTo(9, -1, -2, 4);
      c.closePath();
      metalShape(c, mat, -2, -8, 19, 4, 1.4);
      c.beginPath();
      c.moveTo(2, -4);
      c.quadraticCurveTo(-8, -6, -12, 0);
      c.quadraticCurveTo(-6, 1, 2, 4);
      c.closePath();
      metalShape(c, mat, -12, -6, 2, 4, 1.4);
      c.restore();
      return;
    }
    case 'spear':
    case 'trident':
    case 'glaive':
    case 'lance': {
      const len = fam === 'lance' ? 54 : fam === 'glaive' ? 46 : 52;
      drawHaft(c, len, fam === 'lance' ? 5 : 3.4, fam === 'lance' ? '#5a4230' : '#6b4a2c');
      c.save();
      c.translate(0, -len);
      if (fam === 'spear') {
        c.beginPath();
        c.moveTo(-4, 4);
        c.quadraticCurveTo(-5, -6, 0, -13);
        c.quadraticCurveTo(5, -6, 4, 4);
        c.quadraticCurveTo(0, 6.5, -4, 4);
        c.closePath();
        metalShape(c, mat, -5, -13, 5, 5, 1.4);
      } else if (fam === 'trident') {
        for (const dx of [-7, 0, 7]) {
          c.beginPath();
          c.moveTo(dx - 2, 3);
          c.quadraticCurveTo(dx - 2.5, -6, dx, -12);
          c.quadraticCurveTo(dx + 2.5, -6, dx + 2, 3);
          c.closePath();
          metalShape(c, mat, dx - 2.5, -12, dx + 2.5, 3, 1.2);
        }
        c.fillStyle = mat.base;
        c.beginPath();
        c.roundRect(-8.5, 2, 17, 3.4, 1.6);
        c.fill();
        ink(c, 1.1);
      } else if (fam === 'glaive') {
        c.beginPath();
        c.moveTo(-2.5, 6);
        c.quadraticCurveTo(-10, -4, -6, -20);
        c.quadraticCurveTo(3, -12, 4.5, 2);
        c.quadraticCurveTo(2, 7, -2.5, 6);
        c.closePath();
        metalShape(c, mat, -10, -20, 5, 6, 1.5);
      } else {
        c.beginPath();
        c.moveTo(-4.5, 6);
        c.quadraticCurveTo(-2, -10, 0, -18);
        c.quadraticCurveTo(2, -10, 4.5, 6);
        c.closePath();
        metalShape(c, mat, -4.5, -18, 4.5, 6, 1.4);
        // vamplate
        c.fillStyle = linGrad(c, -8, 10, 8, 20, [
          [0, mat.hi],
          [1, mat.lo]
        ]);
        c.beginPath();
        c.moveTo(-8, 22);
        c.quadraticCurveTo(0, 10, 8, 22);
        c.closePath();
        c.fill();
        ink(c, 1.3);
      }
      enchantFill(c, mat, 0, -6, 22);
      c.restore();
      return;
    }
    case 'staff':
    case 'sceptre':
    case 'wand': {
      const len = fam === 'wand' ? 22 : fam === 'sceptre' ? 40 : 52;
      drawHaft(c, len, fam === 'wand' ? 2.8 : 3.6, '#4b3a5c');
      c.save();
      c.translate(0, -len);
      const gemR = fam === 'staff' ? 6.5 : fam === 'sceptre' ? 5.5 : 4;
      if (fam !== 'wand') {
        c.strokeStyle = mat.base;
        c.lineWidth = 2.4;
        c.lineCap = 'round';
        c.beginPath();
        c.arc(0, 0, gemR + 3.4, Math.PI * 0.15, Math.PI * 0.85, true);
        c.stroke();
        c.beginPath();
        c.moveTo(-gemR - 3.4, 1.5);
        c.lineTo(-gemR - 5, 7);
        c.moveTo(gemR + 3.4, 1.5);
        c.lineTo(gemR + 5, 7);
        c.stroke();
      }
      const gemCol = mat.glow || mat.accent;
      const pulse = 0.75 + Math.sin(t * 4) * 0.25 + charge * 0.5;
      glow(c, 0, 0, gemR * 4.2, gemCol, 0.55 * pulse);
      c.fillStyle = radGrad(c, -gemR * 0.3, -gemR * 0.3, 0, 0, 0, gemR, [
        [0, '#ffffff'],
        [0.45, lighten(gemCol, 0.3)],
        [1, darken(gemCol, 0.25)]
      ]);
      c.beginPath();
      c.arc(0, 0, gemR, 0, TAU);
      c.fill();
      ink(c, 1.2);
      c.restore();
      return;
    }
    case 'scythe': {
      drawHaft(c, 48, 3.6, '#4a3b2c');
      c.save();
      c.translate(0, -48);
      c.beginPath();
      c.moveTo(0, 2);
      c.quadraticCurveTo(-4, -8, -22, -12);
      c.quadraticCurveTo(-30, -12, -33, -4);
      c.quadraticCurveTo(-22, -6, -14, -1);
      c.quadraticCurveTo(-5, 4, 0, 6);
      c.closePath();
      metalShape(c, mat, -33, -14, 0, 6, 1.6);
      c.fillStyle = alpha(mat.spec, 0.55);
      c.beginPath();
      c.moveTo(-2, 1);
      c.quadraticCurveTo(-16, -8, -30, -8);
      c.quadraticCurveTo(-18, -4, -3, 3);
      c.closePath();
      c.fill();
      enchantFill(c, mat, -16, -6, 30);
      c.restore();
      return;
    }
    case 'bow': {
      const gc = mat.glow || mat.accent;
      c.strokeStyle = linGrad(c, -8, -26, 8, 26, [
        [0, mat.hi],
        [0.5, mat.base],
        [1, mat.lo]
      ]);
      c.lineWidth = 3.6;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(2, -26);
      c.quadraticCurveTo(-14 - charge * 4, 0, 2, 26);
      c.stroke();
      c.strokeStyle = 'rgba(240,240,230,0.85)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(2, -26);
      c.lineTo(6 + charge * 9, 0);
      c.lineTo(2, 26);
      c.stroke();
      if (charge > 0.1) {
        c.strokeStyle = alpha(gc, 0.9);
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(6 + charge * 9, 0);
        c.lineTo(-16, 0);
        c.stroke();
        glow(c, -10, 0, 14, gc, charge);
      }
      if (mat.emissive > 0.3) glow(c, -2, 0, 26, gc, mat.emissive * 0.35);
      return;
    }
    case 'claws': {
      c.fillStyle = linGrad(c, -6, 0, 6, 8, [
        [0, LEATHER],
        [1, LEATHER_DARK]
      ]);
      c.beginPath();
      c.roundRect(-5.5, -3, 11, 9, 3);
      c.fill();
      ink(c, 1.2);
      for (let i = -1; i <= 1; i++) {
        c.save();
        c.translate(i * 4, -3);
        c.rotate(i * 0.22);
        c.beginPath();
        spike(c, 0, 0, 17, 4.4, -Math.PI / 2 - 0.25, 0.3);
        metalShape(c, mat, -3, -18, 3, 0, 1.2);
        c.restore();
      }
      enchantFill(c, mat, 0, -12, 20);
      return;
    }
    case 'gauntlet': {
      c.beginPath();
      c.roundRect(-7, -9, 14, 16, 4);
      metalShape(c, mat, -7, -9, 7, 7, 1.6);
      c.fillStyle = alpha(mat.lo, 0.7);
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.roundRect(-6 + i * 4.4, -8.5, 3.4, 6, 1.4);
        c.fill();
      }
      const gc = mat.glow || mat.accent;
      c.fillStyle = gc;
      c.beginPath();
      c.arc(0, 1.5, 2.6, 0, TAU);
      c.fill();
      glow(c, 0, 1.5, 14, gc, 0.55 + Math.sin(t * 5) * 0.15);
      return;
    }
    case 'flail': {
      drawHaft(c, 20, 3.6);
      const sway = Math.sin(t * 5) * 8;
      c.strokeStyle = '#8a8f9c';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, -20);
      c.quadraticCurveTo(sway * 0.5, -28, sway, -34);
      c.stroke();
      c.save();
      c.translate(sway, -38);
      c.fillStyle = radGrad(c, -2, -2, 0, 0, 0, 8, [
        [0, mat.hi],
        [1, mat.lo]
      ]);
      c.beginPath();
      c.arc(0, 0, 7, 0, TAU);
      c.fill();
      ink(c, 1.4);
      c.fillStyle = mat.base;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        c.beginPath();
        spike(c, Math.cos(a) * 6, Math.sin(a) * 6, 5.5, 3.4, a, 0);
        c.fill();
      }
      enchantFill(c, mat, 0, 0, 20);
      c.restore();
      return;
    }
    case 'chakram': {
      const r = 15;
      c.save();
      c.rotate(t * 3);
      c.strokeStyle = linGrad(c, -r, -r, r, r, [
        [0, mat.hi],
        [0.5, mat.base],
        [1, mat.lo]
      ]);
      c.lineWidth = 4.5;
      c.beginPath();
      c.arc(0, 0, r, 0, TAU);
      c.stroke();
      c.fillStyle = mat.spec;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        c.beginPath();
        spike(c, Math.cos(a) * r, Math.sin(a) * r, 6, 4, a, 0.2);
        c.fill();
      }
      c.restore();
      enchantFill(c, mat, 0, 0, 34);
      return;
    }
  }
}

/* ================================================================ offhand == */

function drawOffhand(c: Ctx, type: OffhandType, mat: Material, t: number) {
  switch (type) {
    case 'none':
      return;
    case 'orb': {
      const gc = mat.glow || mat.accent;
      const r = 7;
      glow(c, 0, 0, r * 4, gc, 0.7);
      c.fillStyle = radGrad(c, -2, -2, 0, 0, 0, r, [
        [0, '#fff'],
        [0.4, lighten(gc, 0.25)],
        [1, darken(gc, 0.35)]
      ]);
      c.beginPath();
      c.arc(0, 0, r, 0, TAU);
      c.fill();
      ink(c, 1.2);
      c.strokeStyle = alpha('#ffffff', 0.5);
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(0, 0, r + 3, 2.6, t * 1.4, 0, TAU);
      c.stroke();
      return;
    }
    case 'torch': {
      drawHaft(c, 16, 3);
      const fy = -18;
      const f = Math.sin(t * 9) * 1.6;
      glow(c, 0, fy, 20, '#ffb14d', 0.85);
      c.fillStyle = '#ff9330';
      c.beginPath();
      c.moveTo(-4, fy + 4);
      c.quadraticCurveTo(-5 + f, fy - 6, 0, fy - 12 - f);
      c.quadraticCurveTo(5 + f, fy - 6, 4, fy + 4);
      c.closePath();
      c.fill();
      c.fillStyle = '#ffe28a';
      c.beginPath();
      c.moveTo(-2, fy + 3);
      c.quadraticCurveTo(-2.4 + f, fy - 3, 0, fy - 7 - f);
      c.quadraticCurveTo(2.4 + f, fy - 3, 2, fy + 3);
      c.closePath();
      c.fill();
      return;
    }
    case 'tome': {
      c.save();
      c.rotate(0.2);
      c.fillStyle = linGrad(c, -9, -11, 9, 11, [
        [0, mat.hi],
        [1, mat.lo]
      ]);
      c.beginPath();
      c.roundRect(-9, -11, 18, 22, 2);
      c.fill();
      ink(c, 1.4);
      c.fillStyle = '#efe6cf';
      c.beginPath();
      c.roundRect(-6.5, -9, 13, 18, 1);
      c.fill();
      c.fillStyle = mat.accent;
      c.beginPath();
      c.arc(0, 0, 3, 0, TAU);
      c.fill();
      glow(c, 0, 0, 16, mat.glow || mat.accent, 0.5);
      c.restore();
      return;
    }
    case 'dagger':
      c.save();
      c.rotate(Math.PI);
      drawGrip(c, mat, 7, 4.5);
      drawBlade(c, mat, 15, 4.6, 0, false);
      c.restore();
      return;
    default: {
      const tower = type === 'tower';
      const buckler = type === 'buckler';
      const w = buckler ? 11 : tower ? 17 : 14;
      const h = buckler ? 11 : tower ? 27 : 20;
      c.save();
      c.beginPath();
      if (buckler) {
        c.arc(0, 0, w, 0, TAU);
      } else {
        c.moveTo(-w, -h * 0.72);
        c.quadraticCurveTo(0, -h * 0.92, w, -h * 0.72);
        c.lineTo(w * 0.86, h * 0.34);
        c.quadraticCurveTo(0, h, -w * 0.86, h * 0.34);
        c.closePath();
      }
      metalShape(c, mat, -w, -h, w, h, 2);
      c.strokeStyle = alpha(mat.accent, 0.8);
      c.lineWidth = 2.2;
      c.beginPath();
      if (buckler) c.arc(0, 0, w - 2.6, 0, TAU);
      else {
        c.moveTo(-w + 3, -h * 0.66);
        c.quadraticCurveTo(0, -h * 0.82, w - 3, -h * 0.66);
        c.lineTo(w * 0.72, h * 0.28);
        c.quadraticCurveTo(0, h * 0.84, -w * 0.72, h * 0.28);
        c.closePath();
      }
      c.stroke();
      // boss stud
      c.fillStyle = radGrad(c, -1.5, -2, 0, 0, 0, 5, [
        [0, mat.spec],
        [1, mat.lo]
      ]);
      c.beginPath();
      c.arc(0, buckler ? 0 : -h * 0.12, 4.4, 0, TAU);
      c.fill();
      ink(c, 1.2);
      c.fillStyle = alpha('#ffffff', 0.14);
      c.beginPath();
      c.moveTo(-w * 0.8, -h * 0.5);
      c.lineTo(-w * 0.1, -h * 0.62);
      c.lineTo(-w * 0.2, h * 0.4);
      c.lineTo(-w * 0.75, h * 0.12);
      c.closePath();
      c.fill();
      c.restore();
      enchantFill(c, mat, 0, 0, h * 1.6);
    }
  }
}

/* ================================================================== main === */

/** Weapon families that read better held two-handed / lowered. */
const POLE = new Set<WeaponFamily>(['spear', 'trident', 'glaive', 'lance', 'staff', 'scythe', 'sceptre']);

export function drawHeroRig(
  c: Ctx,
  look: HeroLook,
  pose: HeroPose,
  opts: DrawOpts
) {
  const t = opts.time;
  const offKind = offhandType(look.offhandId);
  const hasShield = offKind === 'buckler' || offKind === 'kite' || offKind === 'tower';
  const rig = buildRig(pose, t, hasShield ? 'shield' : 'weapon');
  const style = armorStyle(look.armorId, look.armorRarity);
  const armorMat = material(style.tone, look.armorRarity, style.metal);
  const bootsMat = material(
    look.bootsId && ARMOR_TONE[look.bootsId] ? ARMOR_TONE[look.bootsId] : /plate|iron|steel|greave/.test(look.bootsId ?? '') ? '#9aa5c2' : LEATHER,
    look.bootsRarity,
    /plate|iron|steel|greave/.test(look.bootsId ?? '') ? 0.9 : 0.3
  );
  const fam = weaponFamily(look.weaponId);
  const wMat = material(look.weaponId?.includes('void') ? '#4a3f6b' : STEEL, look.weaponRarity, 0.95);
  const off = offhandType(look.offhandId);
  const offMat = material(look.offhandId && ARMOR_TONE[look.offhandId] ? ARMOR_TONE[look.offhandId] : '#8d97ae', look.offhandRarity, 0.85);
  const gloveTone = style.cls === 'plate' ? armorMat.base : style.cls === 'cloth' ? SKIN : LEATHER;

  c.save();
  if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
  groundShadow(c, 22, 6, 0.45);
  c.translate(rig.offX, 0);
  c.save();
  c.scale(1, rig.squash);

  // aura for mythic gear
  const auraSrc = [look.weaponRarity, look.armorRarity, look.helmRarity].filter(Boolean);
  if (auraSrc.includes('mythic') || auraSrc.includes('legendary')) {
    const col = auraSrc.includes('mythic') ? '#ff4d6d' : '#f2a541';
    glow(c, 0, -52, 46 + Math.sin(t * 2.6) * 4, col, 0.28);
  }

  if (style.cape) drawCape(c, rig, material(darken(style.tone, 0.12), look.armorRarity, 0.15), t, pose);

  // ---- back layer
  drawLegs(c, rig, style, bootsMat, look.bootsId, true);
  drawArm(c, rig.armBack, style, armorMat, true, gloveTone);

  // pole weapons rest behind the body
  // Pole arms rest behind the body except when in use — and a guard without
  // a shield brings the pole across the body like any other weapon.
  const poleBehind = POLE.has(fam!) && pose !== 'attack' && pose !== 'cast' && !(pose === 'defend' && !hasShield);
  if (fam && poleBehind) {
    c.save();
    c.translate(rig.armBack.c.x, rig.armBack.c.y);
    c.rotate(rig.armBack.angle + Math.PI / 2 + 0.35);
    drawWeapon(c, fam, wMat, t, 0);
    c.restore();
  }

  drawTorso(c, rig, style, armorMat);
  drawLegs(c, rig, style, bootsMat, look.bootsId, false);

  // pauldrons ride on the shoulder line, rotated with the lean
  if (style.pauldrons > 0) {
    const heavy = style.pauldrons > 1;
    c.save();
    c.translate(0, rig.chestY);
    c.rotate(rig.lean);
    c.translate(0, -rig.chestY);
    drawPauldron(c, -11, rig.chestY - 1, material(darken(armorMat.base, 0.2), look.armorRarity, style.metal), heavy ? 7.5 : 6, heavy);
    c.restore();
  }

  drawHead(c, rig, look, pose, t);

  // offhand rides on the back hand but draws in front of the torso
  if (off !== 'none') {
    c.save();
    c.translate(rig.armBack.c.x + 3, rig.armBack.c.y + 2);
    // Guarding: the shield squares up toward the threat.
    c.rotate(pose === 'defend' ? (hasShield ? -0.08 : -0.15) : 0.08 + Math.sin(t * 2) * 0.03);
    drawOffhand(c, off, offMat, t);
    c.restore();
  }

  // front shoulder pauldron over the arm
  if (style.pauldrons > 0) {
    c.save();
    c.translate(0, rig.chestY);
    c.rotate(rig.lean);
    c.translate(0, -rig.chestY);
    drawPauldron(c, 10, rig.chestY - 1, armorMat, style.pauldrons > 1 ? 8 : 6.4, style.pauldrons > 1);
    c.restore();
  }

  drawArm(c, rig.armFront, style, armorMat, false, gloveTone);

  if (fam && !poleBehind && fam !== 'fist') {
    const charge = pose === 'cast' ? 0.5 + Math.sin(t * 4) * 0.4 : pose === 'attack' ? clamp(((t % 0.72) / 0.72) * 2, 0, 1) : 0.15;
    c.save();
    c.translate(rig.armFront.c.x, rig.armFront.c.y);
    let rot = rig.armFront.angle + Math.PI / 2 + rig.weaponRot;
    if (fam === 'bow') rot = rig.armFront.angle + Math.PI / 2 - 0.1;
    if (fam === 'chakram' || fam === 'gauntlet' || fam === 'claws') rot = rig.armFront.angle + Math.PI / 2;
    c.rotate(rot);
    drawWeapon(c, fam, wMat, t, charge);
    c.restore();

    // motion arc on the strike frames
    if (pose === 'attack') {
      const q = (t % 0.72) / 0.72;
      if (q > 0.42 && q < 0.68) {
        const k = 1 - (q - 0.42) / 0.26;
        c.save();
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = alpha(wMat.glow || '#cfe4ff', 0.5 * k);
        c.lineWidth = 5 * k + 1;
        c.lineCap = 'round';
        c.beginPath();
        // Sweep from over the shoulder down into the thrust line.
        c.arc(12, rig.chestY + 2, 42, -Math.PI * 0.72, 0.06);
        c.stroke();
        c.restore();
      }
    }
  }

  // trinket: a floating charm orbiting the shoulder
  if (look.trinketId) {
    const tMat = material('#9fd8ff', look.trinketRarity, 0.6);
    const col = tMat.glow || tMat.accent;
    const ang = t * 1.6;
    const tx = -13 + Math.cos(ang) * 3;
    const ty = rig.chestY + 6 + Math.sin(ang * 1.3) * 2.5;
    glow(c, tx, ty, 11, col, 0.75);
    c.fillStyle = lighten(col, 0.4);
    poly(c, [tx, ty - 3.4, tx + 2.6, ty, tx, ty + 3.4, tx - 2.6, ty]);
    c.fill();
  }

  c.restore(); // squash

  if (opts.flash) {
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.globalAlpha = clamp(opts.flash, 0, 1) * 0.85;
    c.fillStyle = '#fff';
    c.fillRect(-70, -124, 170, 130);
    c.restore();
  }
  c.restore();
}

/**
 * Silhouette bounds used for portraits and for the offscreen cache size.
 * `h` is the standing height (portraits scale on it); `w` is the half-extent
 * budget that a full attack thrust (weapon included) stays within.
 */
export const HERO_BOUNDS = { w: 92, h: 116 };

export { blobPath, limb, drawBlade };

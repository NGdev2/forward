/* ============================================================================
 * Parametric creature system.
 *
 * A creature is described by a small design descriptor (archetype + palette +
 * feature flags). `CREATURE_TABLE` maps every shipped enemy/boss id onto a
 * hand-tuned descriptor; anything unknown falls back to a deterministic design
 * derived from the id hash, so new content always renders coherently.
 *
 * Local space: feet on y = 0, up is -y. A `size` of 1 is roughly 80 units tall.
 * ========================================================================== */

import type { CreaturePose, DrawOpts } from './api';
import {
  BONE,
  alpha,
  darken,
  hash,
  lighten,
  mix,
  rand01,
  vivid
} from './palette';
import {
  blobPath,
  eye,
  glow,
  groundShadow,
  ink,
  jointLimb,
  limb,
  linGrad,
  poly,
  radGrad,
  rimArc,
  shadedEllipse,
  spike,
  toonEye
} from './shapes';
import { material, type Material } from './palette';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export type Archetype =
  | 'beast'
  | 'humanoid'
  | 'undead'
  | 'dragon'
  | 'blob'
  | 'construct'
  | 'spectre'
  | 'insect'
  | 'bird'
  | 'serpent';

export type Horns = 'none' | 'pair' | 'crown' | 'single' | 'antler' | 'ram';
export type Wings = 'none' | 'bat' | 'feather' | 'insect' | 'shadow';
export type Tail = 'none' | 'thin' | 'thick' | 'spiked' | 'tuft' | 'fan';
export type Maw = 'fangs' | 'beak' | 'tusks' | 'jaws' | 'mandible' | 'none';
export type Aura = 'none' | 'fire' | 'frost' | 'void' | 'holy' | 'poison' | 'storm' | 'blood';

export interface CreatureDesign {
  arch: Archetype;
  /** Body base colour; the rest of the ramp is derived from it. */
  main: string;
  accent: string;
  eyeColor: string;
  /** 1 ≈ 80 units tall. */
  size: number;
  bulk: number;
  horns: Horns;
  hornLen: number;
  eyes: number;
  wings: Wings;
  tail: Tail;
  spikes: number;
  maw: Maw;
  aura: Aura;
  boss: boolean;
  mane: boolean;
  plates: boolean;
  glowEyes: boolean;
  heads: number;
  armed: boolean;
  seed: number;
}

const DEFAULTS: Omit<CreatureDesign, 'arch' | 'main' | 'seed'> = {
  accent: '',
  eyeColor: '#ffd166',
  size: 1,
  bulk: 1,
  horns: 'none',
  hornLen: 1,
  eyes: 2,
  wings: 'none',
  tail: 'none',
  spikes: 0,
  maw: 'fangs',
  aura: 'none',
  boss: false,
  mane: false,
  plates: false,
  glowEyes: false,
  heads: 1,
  armed: false
};

type Spec = Partial<CreatureDesign> & { arch: Archetype; main: string };

/* ---------------------------------------------------------------- table --- */

const CREATURE_TABLE: Record<string, Spec> = {
  /* ---- tier 1 ---- */
  e_rat: { arch: 'beast', main: '#7b6a5c', size: 0.62, bulk: 0.85, tail: 'thin', maw: 'fangs', eyeColor: '#ff6b6b' },
  e_slime: { arch: 'blob', main: '#4fd18b', size: 0.66, eyes: 2, maw: 'none', eyeColor: '#0f2a1c', accent: '#b6ffd9' },
  e_bat: { arch: 'bird', main: '#4b4058', size: 0.58, wings: 'bat', maw: 'fangs', eyeColor: '#ff8a5c', tail: 'thin' },
  e_crow: { arch: 'bird', main: '#2f3140', size: 0.62, wings: 'feather', maw: 'beak', eyeColor: '#ffcf5c', tail: 'fan' },

  /* ---- tier 2 ---- */
  e_goblin: { arch: 'humanoid', main: '#7fa350', size: 0.78, bulk: 0.9, maw: 'fangs', eyes: 2, eyeColor: '#ffe066', armed: true, horns: 'none' },
  e_spider: { arch: 'insect', main: '#3d3350', size: 0.7, eyes: 4, maw: 'mandible', eyeColor: '#ff4d6d', accent: '#8f6bd8' },
  e_boar: { arch: 'beast', main: '#6b5341', size: 0.86, bulk: 1.2, maw: 'tusks', tail: 'tuft', mane: true, eyeColor: '#ff9f43' },
  e_bandit: { arch: 'humanoid', main: '#8a5a3c', size: 0.86, armed: true, maw: 'none', eyeColor: '#ffe066' },

  /* ---- tier 3 ---- */
  e_skeleton: { arch: 'undead', main: '#e4dcc4', size: 0.88, armed: true, eyeColor: '#7ee8ff', glowEyes: true, maw: 'jaws' },
  e_wolf: { arch: 'beast', main: '#5c6070', size: 0.92, bulk: 1.05, tail: 'thick', mane: true, maw: 'fangs', eyeColor: '#ffe066' },
  e_orc: { arch: 'humanoid', main: '#5f8a4e', size: 1.0, bulk: 1.35, maw: 'tusks', armed: true, eyeColor: '#ff5c3a', spikes: 2 },
  e_ghoul: { arch: 'undead', main: '#9aa87c', size: 0.9, bulk: 1.1, maw: 'jaws', eyeColor: '#c6ff5c', glowEyes: true, armed: false },

  /* ---- tier 4 ---- */
  e_wraith: { arch: 'spectre', main: '#5a6fa8', size: 1.0, aura: 'void', eyeColor: '#a8e8ff', glowEyes: true, maw: 'none' },
  e_troll: { arch: 'humanoid', main: '#6d8a6a', size: 1.2, bulk: 1.6, maw: 'tusks', horns: 'none', eyeColor: '#ffd166', armed: true },
  e_harpy: { arch: 'bird', main: '#b0764f', size: 1.0, wings: 'feather', maw: 'beak', tail: 'fan', eyeColor: '#ff4d6d', mane: true },
  e_minotaur: { arch: 'humanoid', main: '#7a4c34', size: 1.22, bulk: 1.45, horns: 'ram', hornLen: 1.2, maw: 'tusks', armed: true, eyeColor: '#ff5c3a', mane: true },

  /* ---- tier 5 ---- */
  e_golem: { arch: 'construct', main: '#7c8391', size: 1.24, bulk: 1.5, plates: true, eyeColor: '#8fd8ff', glowEyes: true, maw: 'none' },
  e_wyvern: { arch: 'dragon', main: '#4f8f6e', size: 1.2, wings: 'bat', tail: 'spiked', horns: 'pair', maw: 'jaws', eyeColor: '#ffd166', spikes: 4 },
  e_banshee: { arch: 'spectre', main: '#8a6fb8', size: 1.05, aura: 'void', eyeColor: '#ff9ad4', glowEyes: true, maw: 'jaws' },

  /* ---- tier 6 ---- */
  e_lich: { arch: 'undead', main: '#c9c2a8', size: 1.1, armed: true, aura: 'void', eyeColor: '#7ee8ff', glowEyes: true, maw: 'jaws', accent: '#4a3f7a' },
  e_hydra: { arch: 'serpent', main: '#3f8f7a', size: 1.25, heads: 3, maw: 'jaws', eyeColor: '#ffd166', spikes: 5 },
  e_chimera: { arch: 'beast', main: '#b07a3a', size: 1.2, bulk: 1.35, mane: true, horns: 'pair', tail: 'spiked', maw: 'fangs', wings: 'bat', eyeColor: '#ff5c3a' },

  /* ---- tier 7 ---- */
  e_direbear: { arch: 'beast', main: '#4a3c38', size: 1.3, bulk: 1.6, mane: true, maw: 'fangs', aura: 'fire', eyeColor: '#ff8a3a', spikes: 3 },
  e_gargoyle: { arch: 'construct', main: '#6a7180', size: 1.2, bulk: 1.2, wings: 'bat', horns: 'pair', maw: 'fangs', plates: true, eyeColor: '#a8e8ff', glowEyes: true, aura: 'storm' },
  e_revenant: { arch: 'undead', main: '#8f8a7a', size: 1.15, armed: true, aura: 'void', eyeColor: '#ff4d6d', glowEyes: true, accent: '#2b2740' },

  /* ---- tier 8 ---- */
  e_wyrm: { arch: 'dragon', main: '#6f7b8c', size: 1.4, wings: 'bat', tail: 'spiked', horns: 'crown', maw: 'jaws', plates: true, spikes: 6, eyeColor: '#ffd166' },
  e_behemoth: { arch: 'beast', main: '#b09163', size: 1.5, bulk: 1.9, horns: 'pair', maw: 'tusks', plates: true, tail: 'thick', eyeColor: '#ffe066' },
  e_specterlord: { arch: 'spectre', main: '#3f4a7a', size: 1.3, aura: 'void', eyeColor: '#c6a8ff', glowEyes: true, horns: 'crown', armed: true },

  /* ---- tier 9 ---- */
  e_frostgiant: { arch: 'humanoid', main: '#7fb2cc', size: 1.55, bulk: 1.8, aura: 'frost', maw: 'tusks', armed: true, eyeColor: '#d8f4ff', glowEyes: true, mane: true },
  e_direphoenix: { arch: 'bird', main: '#d8622f', size: 1.4, wings: 'feather', maw: 'beak', tail: 'fan', aura: 'fire', eyeColor: '#ffe9a8', glowEyes: true, mane: true },
  e_krakenling: { arch: 'insect', main: '#4a5f8f', size: 1.35, bulk: 1.4, eyes: 2, maw: 'mandible', aura: 'storm', eyeColor: '#7ee8ff', glowEyes: true, accent: '#7a5fb8' },

  /* ---- tier 10 ---- */
  e_voidspawn: { arch: 'blob', main: '#3a2d5c', size: 1.4, bulk: 1.3, eyes: 4, aura: 'void', eyeColor: '#ff4d6d', glowEyes: true, maw: 'fangs', spikes: 5, accent: '#8f6bd8' },
  e_starwyrm: { arch: 'serpent', main: '#3d4a8c', size: 1.45, heads: 1, maw: 'jaws', aura: 'holy', eyeColor: '#ffe9a8', glowEyes: true, spikes: 7, plates: true },
  e_deathless: { arch: 'undead', main: '#a8a08c', size: 1.6, bulk: 1.7, armed: true, aura: 'void', eyeColor: '#7ee8ff', glowEyes: true, horns: 'crown', plates: true },

  /* ================================ bosses ================================ */
  b_ratking: { arch: 'beast', main: '#6f5e50', size: 1.5, bulk: 1.5, boss: true, horns: 'crown', tail: 'thin', maw: 'fangs', eyeColor: '#ff4d6d', mane: true, aura: 'poison' },
  b_goblinchief: { arch: 'humanoid', main: '#6f9448', size: 1.45, bulk: 1.4, boss: true, armed: true, horns: 'pair', maw: 'fangs', eyeColor: '#ffe066', spikes: 3 },
  b_directwolf: { arch: 'beast', main: '#4b5060', size: 1.55, bulk: 1.35, boss: true, mane: true, tail: 'thick', maw: 'fangs', eyeColor: '#7ee8ff', glowEyes: true, aura: 'frost' },
  b_orcwarlord: { arch: 'humanoid', main: '#4f7a42', size: 1.65, bulk: 1.8, boss: true, armed: true, maw: 'tusks', spikes: 5, plates: true, eyeColor: '#ff5c3a', horns: 'pair', aura: 'blood' },
  b_wraithqueen: { arch: 'spectre', main: '#6a4f9a', size: 1.6, boss: true, aura: 'void', horns: 'crown', eyeColor: '#ff9ad4', glowEyes: true, armed: true },
  b_stonetitan: { arch: 'construct', main: '#6f7686', size: 1.85, bulk: 1.9, boss: true, plates: true, spikes: 6, eyeColor: '#ffb14d', glowEyes: true, aura: 'fire' },
  b_wyvernlord: { arch: 'dragon', main: '#3f7f9c', size: 1.75, boss: true, wings: 'bat', tail: 'spiked', horns: 'crown', maw: 'jaws', spikes: 7, plates: true, eyeColor: '#ffd166', aura: 'storm' },
  b_lich: { arch: 'undead', main: '#d4cdb2', size: 1.6, boss: true, armed: true, aura: 'void', horns: 'crown', eyeColor: '#7ee8ff', glowEyes: true, accent: '#3a2f6b' },
  b_hydra: { arch: 'serpent', main: '#357f68', size: 1.8, heads: 5, boss: true, maw: 'jaws', spikes: 8, eyeColor: '#c6ff5c', glowEyes: true, aura: 'poison' },
  b_voidherald: { arch: 'spectre', main: '#2b2450', size: 1.9, boss: true, aura: 'void', horns: 'crown', eyes: 4, eyeColor: '#ff4d6d', glowEyes: true, wings: 'shadow', armed: true },
  b_thornqueen: { arch: 'humanoid', main: '#5f7a3a', size: 1.6, boss: true, horns: 'antler', hornLen: 1.4, aura: 'poison', eyeColor: '#c6ff5c', glowEyes: true, mane: true, armed: true, spikes: 5 },
  b_juggernaut: { arch: 'construct', main: '#8a6f4a', size: 1.9, bulk: 2, boss: true, plates: true, eyeColor: '#ff4d6d', glowEyes: true, aura: 'fire', spikes: 4 },
  b_stormcaller: { arch: 'humanoid', main: '#4f6f9c', size: 1.7, boss: true, armed: true, aura: 'storm', horns: 'crown', eyeColor: '#a8e8ff', glowEyes: true, mane: true },
  b_abysslord: { arch: 'blob', main: '#241f3f', size: 1.9, bulk: 1.6, boss: true, eyes: 6, aura: 'void', eyeColor: '#ff4d6d', glowEyes: true, maw: 'fangs', spikes: 7, accent: '#7a4dd8' },
  b_frostmonarch: { arch: 'humanoid', main: '#9fd2e8', size: 1.75, bulk: 1.4, boss: true, aura: 'frost', horns: 'crown', eyeColor: '#e6faff', glowEyes: true, armed: true, plates: true },
  b_bloodreaver: { arch: 'humanoid', main: '#8f3a3a', size: 1.75, bulk: 1.7, boss: true, armed: true, aura: 'blood', horns: 'pair', maw: 'fangs', spikes: 6, plates: true, eyeColor: '#ff8a8a', glowEyes: true },
  b_starweaver: { arch: 'spectre', main: '#4a4f9c', size: 1.8, boss: true, aura: 'holy', horns: 'crown', eyes: 3, eyeColor: '#ffe9a8', glowEyes: true, wings: 'shadow', armed: true },
  b_worldeater: { arch: 'dragon', main: '#8a4028', size: 2.05, boss: true, wings: 'bat', tail: 'spiked', horns: 'crown', maw: 'jaws', spikes: 9, plates: true, aura: 'fire', eyeColor: '#ffd166', glowEyes: true },
  b_timeless: { arch: 'spectre', main: '#6f6a8f', size: 1.85, boss: true, aura: 'holy', horns: 'crown', eyes: 3, eyeColor: '#ffe9a8', glowEyes: true, armed: true },
  b_omegasovereign: { arch: 'construct', main: '#3a3652', size: 2.1, boss: true, bulk: 1.7, plates: true, spikes: 8, aura: 'void', eyeColor: '#ff4d6d', glowEyes: true, horns: 'crown', wings: 'shadow' }
};

const FALLBACK_ARCH: Archetype[] = ['beast', 'humanoid', 'undead', 'dragon', 'blob', 'construct', 'spectre', 'insect', 'bird', 'serpent'];
const FALLBACK_HUES = ['#7a8f4e', '#8a5a3c', '#4f7f9c', '#7a4c8a', '#8f6b3a', '#4a8a6a', '#8f4a4a', '#5c6070'];
const FALLBACK_AURA: Aura[] = ['none', 'none', 'fire', 'frost', 'void', 'poison', 'storm', 'holy'];

const CACHE = new Map<string, CreatureDesign>();

export function creatureDesign(id: string): CreatureDesign {
  const hit = CACHE.get(id);
  if (hit) return hit;
  const seed = hash(id);
  const spec = CREATURE_TABLE[id];
  let design: CreatureDesign;
  if (spec) {
    design = { ...DEFAULTS, ...spec, seed };
  } else {
    const boss = id.startsWith('b_');
    design = {
      ...DEFAULTS,
      arch: FALLBACK_ARCH[seed % FALLBACK_ARCH.length],
      main: FALLBACK_HUES[(seed >> 3) % FALLBACK_HUES.length],
      seed,
      size: (boss ? 1.5 : 0.8) + rand01(seed, 1) * (boss ? 0.5 : 0.5),
      bulk: 0.9 + rand01(seed, 2) * 0.7,
      horns: (['none', 'pair', 'crown', 'single', 'ram'] as Horns[])[(seed >> 5) % 5],
      eyes: 1 + ((seed >> 7) % 3),
      wings: (['none', 'none', 'bat', 'feather'] as Wings[])[(seed >> 9) % 4],
      tail: (['none', 'thin', 'thick', 'spiked', 'tuft'] as Tail[])[(seed >> 11) % 5],
      spikes: (seed >> 13) % 6,
      maw: (['fangs', 'jaws', 'tusks', 'beak'] as Maw[])[(seed >> 15) % 4],
      aura: boss ? FALLBACK_AURA[2 + ((seed >> 17) % 6)] : FALLBACK_AURA[(seed >> 17) % 8],
      boss,
      glowEyes: boss || rand01(seed, 3) > 0.5,
      plates: boss || rand01(seed, 4) > 0.6,
      mane: rand01(seed, 5) > 0.6,
      armed: rand01(seed, 6) > 0.5,
      eyeColor: boss ? '#ff4d6d' : '#ffd166'
    };
  }
  if (!design.accent) design.accent = vivid(lighten(design.main, 0.3), 0.5);
  CACHE.set(id, design);
  return design;
}

/* ------------------------------------------------------------ animation --- */

interface Anim {
  t: number;
  breathe: number;
  lunge: number;
  crouch: number;
  squashX: number;
  squashY: number;
  rot: number;
  strike: number;
  limbPhase: number;
  headDrop: number;
  eyeSquint: number;
}

function buildAnim(pose: CreaturePose, t: number, seed: number): Anim {
  const off = (seed % 100) / 100;
  const a: Anim = {
    t,
    breathe: Math.sin((t + off) * 2.3),
    lunge: 0,
    crouch: 0,
    squashX: 1,
    squashY: 1,
    rot: 0,
    strike: 0,
    limbPhase: (t + off) * 2.3,
    headDrop: 0,
    eyeSquint: 0
  };
  if (pose === 'idle') {
    a.squashY = 1 + a.breathe * 0.025;
    a.squashX = 1 - a.breathe * 0.018;
  } else if (pose === 'attack') {
    // Wind-up pulls BACK (negative lunge = away from the facing direction),
    // the strike drives FORWARD toward the target, then it settles.
    const q = (t % 0.8) / 0.8;
    if (q < 0.4) {
      const k = q / 0.4;
      a.lunge = -8 * k;
      a.crouch = 5 * k;
      a.squashY = 1 - 0.1 * k;
      a.squashX = 1 + 0.08 * k;
      a.eyeSquint = 0.3 * k;
    } else if (q < 0.55) {
      const k = (q - 0.4) / 0.15;
      a.lunge = -8 + 30 * k;
      a.crouch = 5 - 8 * k;
      a.squashY = 0.9 + 0.22 * k;
      a.squashX = 1.08 - 0.16 * k;
      a.strike = k;
      a.eyeSquint = 0.3 + 0.5 * k;
    } else {
      const k = (q - 0.55) / 0.45;
      a.lunge = 22 - 22 * k;
      a.crouch = -3 + 3 * k;
      a.squashY = 1.12 - 0.12 * k;
      a.squashX = 0.92 + 0.08 * k;
      a.strike = 1 - k;
      a.eyeSquint = 0.8 - 0.8 * k;
    }
    a.limbPhase = t * 7;
  } else if (pose === 'charge') {
    const s = Math.sin(t * 22);
    a.lunge = 4 + s * 1.6;
    a.crouch = 5;
    a.squashY = 0.94;
    a.squashX = 1.06;
    a.eyeSquint = 0.35;
    a.limbPhase = t * 9;
  } else if (pose === 'hurt') {
    const k = clamp(1 - (t % 0.45) / 0.45, 0, 1);
    a.lunge = 12 * k;
    a.crouch = 4 * k;
    a.squashY = 1 - 0.1 * k;
    a.squashX = 1 + 0.1 * k;
    a.headDrop = 5 * k;
    a.eyeSquint = k;
    a.rot = 0.12 * k;
  } else if (pose === 'dead') {
    a.rot = 1.35;
    a.crouch = 6;
    a.squashY = 0.86;
    a.squashX = 1.12;
    a.eyeSquint = 1;
    a.breathe = 0;
  }
  return a;
}

/* ------------------------------------------------------------- materials -- */

interface Skin {
  mat: Material;
  dark: string;
  light: string;
  accent: string;
  belly: string;
}

function skinOf(d: CreatureDesign): Skin {
  const mat = material(d.main, null, 0.35);
  return {
    mat: { ...mat, base: d.main, hi: lighten(d.main, 0.3), lo: darken(d.main, 0.45), spec: lighten(d.main, 0.55) },
    dark: darken(d.main, 0.45),
    light: lighten(d.main, 0.3),
    accent: d.accent,
    belly: mix(lighten(d.main, 0.35), '#e8d8b8', 0.4)
  };
}

const AURA_COLOR: Record<Aura, string> = {
  none: '',
  fire: '#ff7a2f',
  frost: '#8fd8ff',
  void: '#a45cff',
  holy: '#ffe9a8',
  poison: '#8fe04a',
  storm: '#6fa8ff',
  blood: '#ff3a5c'
};

/* ---------------------------------------------------------------- parts --- */

function drawHorns(c: Ctx, d: CreatureDesign, x: number, y: number, r: number, an: Anim) {
  if (d.horns === 'none') return;
  const L = r * 1.5 * d.hornLen;
  c.fillStyle = linGrad(c, x - r, y - L, x + r, y, [
    [0, lighten(BONE, 0.15)],
    [1, darken(BONE, 0.4)]
  ]);
  const stroke = () => {
    c.fill();
    ink(c, 1.2);
  };
  if (d.horns === 'pair') {
    spike(c, x - r * 0.6, y - r * 0.55, L, r * 0.42, -Math.PI / 2 - 0.7, 0.35);
    stroke();
    spike(c, x + r * 0.6, y - r * 0.55, L, r * 0.42, -Math.PI / 2 + 0.7, -0.35);
    stroke();
  } else if (d.horns === 'single') {
    spike(c, x, y - r * 0.8, L * 1.25, r * 0.4, -Math.PI / 2 + 0.25, 0.12);
    stroke();
  } else if (d.horns === 'ram') {
    for (const s of [-1, 1]) {
      c.beginPath();
      c.save();
      c.translate(x + s * r * 0.7, y - r * 0.35);
      c.rotate(s * 0.3);
      c.arc(s * L * 0.42, L * 0.12, L * 0.5, -Math.PI * 0.9, Math.PI * 0.55, s < 0);
      c.lineWidth = r * 0.4;
      c.strokeStyle = BONE;
      c.lineCap = 'round';
      c.stroke();
      c.strokeStyle = alpha('#000', 0.25);
      c.lineWidth = r * 0.14;
      c.stroke();
      c.restore();
    }
  } else if (d.horns === 'antler') {
    c.strokeStyle = BONE;
    c.lineWidth = r * 0.22;
    c.lineCap = 'round';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(x + s * r * 0.5, y - r * 0.5);
      c.lineTo(x + s * r * 1.1, y - L * 0.9);
      c.moveTo(x + s * r * 0.8, y - L * 0.45);
      c.lineTo(x + s * r * 1.6, y - L * 0.6);
      c.moveTo(x + s * r * 0.95, y - L * 0.7);
      c.lineTo(x + s * r * 1.75, y - L * 0.95);
      c.stroke();
    }
  } else if (d.horns === 'crown') {
    // spiked circlet / bone crown — the boss signature
    const w = r * 1.25;
    const pts: number[] = [];
    const n = 5;
    for (let i = 0; i <= n; i++) {
      const px = -w + (i / n) * w * 2;
      pts.push(px, y - r * 0.55);
      if (i < n) pts.push(px + w / n, y - r * 0.55 - L * (i % 2 === 0 ? 0.95 : 0.6));
    }
    c.save();
    c.translate(x, 0);
    c.beginPath();
    c.moveTo(-w, y - r * 0.35);
    for (let i = 0; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.lineTo(w, y - r * 0.35);
    c.closePath();
    c.fillStyle = linGrad(c, -w, y - L, w, y, [
      [0, '#ffe9a8'],
      [0.5, '#e0a840'],
      [1, '#6b4a1c']
    ]);
    c.fill();
    ink(c, 1.3);
    c.fillStyle = d.eyeColor;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.arc(i * w * 0.5, y - r * 0.5, r * 0.12, 0, TAU);
      c.fill();
    }
    c.restore();
    glow(c, x, y - r, r * 3, '#ffcf5c', 0.35 + Math.sin(an.t * 3) * 0.08);
  }
}

function drawEyes(c: Ctx, d: CreatureDesign, x: number, y: number, r: number, an: Anim, spreadScale = 1) {
  const n = Math.max(1, d.eyes);
  const er = r * (n > 3 ? 0.16 : n > 2 ? 0.2 : 0.24);
  const squint = an.eyeSquint;
  if (n <= 2) {
    const dx = n === 1 ? 0 : r * 0.34 * spreadScale;
    for (let i = 0; i < n; i++) {
      const ex = x + (n === 1 ? 0 : (i === 0 ? -dx : dx) + r * 0.18);
      if (d.glowEyes) eye(c, ex, y, er, d.eyeColor, squint);
      else toonEye(c, ex, y, er, 1, 0.6);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2 === 0 ? -1 : 1;
      const ex = x + col * r * (0.2 + row * 0.16) * spreadScale;
      const ey = y + row * er * 1.9 - er;
      if (d.glowEyes) eye(c, ex, ey, er * (1 - row * 0.15), d.eyeColor, squint);
      else toonEye(c, ex, ey, er * (1 - row * 0.15), 1, 0.5);
    }
  }
}

function drawMaw(c: Ctx, d: CreatureDesign, x: number, y: number, r: number, open: number) {
  const s = skinOf(d);
  if (d.maw === 'none') {
    c.strokeStyle = alpha(s.dark, 0.8);
    c.lineWidth = r * 0.1;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x - r * 0.18, y);
    c.quadraticCurveTo(x + r * 0.12, y + r * 0.12, x + r * 0.42, y - r * 0.05);
    c.stroke();
    return;
  }
  if (d.maw === 'beak') {
    c.fillStyle = linGrad(c, x, y - r * 0.3, x + r, y + r * 0.4, [
      [0, '#f2c14e'],
      [1, '#a86b1c']
    ]);
    poly(c, [x - r * 0.05, y - r * 0.28, x + r * 0.95, y + r * 0.02 - open * r * 0.1, x - r * 0.02, y + r * 0.3]);
    c.fill();
    ink(c, 1.2);
    if (open > 0.05) {
      c.fillStyle = '#5c2030';
      poly(c, [x, y + r * 0.1, x + r * 0.7, y + r * 0.14, x, y + r * 0.3 + open * r * 0.24]);
      c.fill();
    }
    return;
  }
  if (d.maw === 'mandible') {
    c.strokeStyle = darken(d.main, 0.55);
    c.lineWidth = r * 0.14;
    c.lineCap = 'round';
    for (const sgn of [-1, 1]) {
      c.beginPath();
      c.moveTo(x + r * 0.1, y + sgn * r * 0.14);
      c.quadraticCurveTo(x + r * 0.7, y + sgn * (r * 0.35 + open * r * 0.25), x + r * 0.95, y + sgn * r * 0.1);
      c.stroke();
    }
    return;
  }
  // fangs / tusks / jaws
  const w = r * 0.62;
  const h = r * (0.16 + open * 0.4);
  c.fillStyle = '#3a1220';
  c.beginPath();
  c.moveTo(x - w * 0.5, y);
  c.quadraticCurveTo(x + w * 0.3, y - h * 0.3, x + w, y + h * 0.05);
  c.quadraticCurveTo(x + w * 0.4, y + h * 1.5, x - w * 0.5, y + h * 0.7);
  c.closePath();
  c.fill();
  ink(c, 1.1);
  c.fillStyle = BONE;
  if (d.maw === 'tusks') {
    for (const sgn of [-1, 1]) {
      spike(c, x + w * 0.35, y + h * (sgn > 0 ? 0.7 : 0.1), r * 0.5, r * 0.16, sgn > 0 ? -Math.PI / 2 - 0.4 : Math.PI / 2 - 0.4, 0.3);
      c.fill();
      ink(c, 0.9);
    }
  } else {
    const n = d.maw === 'jaws' ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const fx = x - w * 0.35 + (i / (n - 1)) * w * 1.15;
      c.beginPath();
      c.moveTo(fx - r * 0.06, y);
      c.lineTo(fx + r * 0.06, y);
      c.lineTo(fx, y + h * 0.75);
      c.closePath();
      c.fill();
      if (d.maw === 'jaws') {
        c.beginPath();
        c.moveTo(fx - r * 0.05, y + h * 1.1);
        c.lineTo(fx + r * 0.05, y + h * 1.1);
        c.lineTo(fx, y + h * 0.4);
        c.closePath();
        c.fill();
      }
    }
  }
}

function drawWings(c: Ctx, d: CreatureDesign, x: number, y: number, span: number, an: Anim, behind: boolean) {
  if (d.wings === 'none') return;
  const flap = Math.sin(an.t * (d.arch === 'bird' ? 5.5 : 2.4)) * (behind ? 0.55 : 0.4);
  const s = skinOf(d);
  const dir = behind ? -1 : 1;
  c.save();
  c.translate(x, y);
  c.rotate(flap * 0.35 * dir - (behind ? 0.12 : 0));
  c.globalAlpha *= behind ? 0.8 : 1;
  const L = span * (behind ? 0.92 : 1);
  if (d.wings === 'feather') {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = -2.5 + (i / (n - 1)) * 1.6;
      const len = L * (0.65 + Math.sin((i / n) * Math.PI) * 0.5);
      c.save();
      c.rotate(a + flap * 0.12);
      c.fillStyle = linGrad(c, 0, 0, 0, -len, [
        [0, behind ? s.dark : s.mat.base],
        [1, behind ? darken(s.dark, 0.2) : s.light]
      ]);
      c.beginPath();
      c.ellipse(0, -len * 0.5, len * 0.16, len * 0.5, 0, 0, TAU);
      c.fill();
      ink(c, 1);
      c.restore();
    }
  } else if (d.wings === 'insect') {
    c.globalAlpha *= 0.55;
    for (const sgn of [-1, 1]) {
      c.fillStyle = alpha(s.accent, 0.5);
      c.beginPath();
      c.ellipse(-L * 0.4, sgn * L * 0.18, L * 0.5, L * 0.18, sgn * 0.4 + flap * 0.2, 0, TAU);
      c.fill();
      ink(c, 0.8, alpha(s.dark, 0.5));
    }
  } else {
    // bat / shadow membrane
    const col = d.wings === 'shadow' ? alpha(darken(d.main, 0.3), 0.75) : s.dark;
    c.fillStyle = linGrad(c, 0, -L, -L, L * 0.4, [
      [0, lighten(col, 0.15)],
      [1, darken(col, 0.25)]
    ]);
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(-L * 0.5, -L * 0.85 - flap * L * 0.2, -L * 1.05, -L * 0.5 - flap * L * 0.15);
    c.quadraticCurveTo(-L * 0.72, -L * 0.16, -L * 0.86, L * 0.12);
    c.quadraticCurveTo(-L * 0.55, -L * 0.06, -L * 0.6, L * 0.34);
    c.quadraticCurveTo(-L * 0.32, L * 0.02, -L * 0.3, L * 0.42);
    c.quadraticCurveTo(-L * 0.1, L * 0.06, 0, 0);
    c.closePath();
    c.fill();
    ink(c, 1.4);
    c.strokeStyle = alpha(darken(col, 0.4), 0.85);
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(-L * 0.86, L * 0.12);
    c.moveTo(0, 0);
    c.lineTo(-L * 0.6, L * 0.34);
    c.moveTo(0, 0);
    c.lineTo(-L * 1.02, -L * 0.48);
    c.stroke();
  }
  c.restore();
}

function drawTail(c: Ctx, d: CreatureDesign, x: number, y: number, len: number, an: Anim) {
  if (d.tail === 'none') return;
  const s = skinOf(d);
  const sway = Math.sin(an.t * 2.6) * len * 0.18;
  const midX = x - len * 0.55;
  const midY = y - len * 0.2 + sway;
  const endX = x - len;
  const endY = y - len * 0.45 + sway * 1.8;
  if (d.tail === 'fan') {
    c.save();
    c.translate(x, y);
    for (let i = -2; i <= 2; i++) {
      c.save();
      c.rotate(Math.PI * 0.9 + i * 0.16 + sway * 0.01);
      c.fillStyle = i % 2 === 0 ? s.mat.base : s.dark;
      c.beginPath();
      c.ellipse(len * 0.45, 0, len * 0.45, len * 0.1, 0, 0, TAU);
      c.fill();
      ink(c, 0.9);
      c.restore();
    }
    c.restore();
    return;
  }
  const w = d.tail === 'thick' || d.tail === 'spiked' ? len * 0.26 : len * 0.13;
  c.fillStyle = linGrad(c, x, y, endX, endY, [
    [0, s.mat.base],
    [1, s.dark]
  ]);
  limb(c, x, y, midX, midY, w, w * 0.6);
  c.fill();
  ink(c, 1.2);
  limb(c, midX, midY, endX, endY, w * 0.6, w * 0.18);
  c.fill();
  ink(c, 1.2);
  if (d.tail === 'tuft') {
    c.fillStyle = s.dark;
    c.beginPath();
    c.ellipse(endX, endY, len * 0.14, len * 0.2, -0.5, 0, TAU);
    c.fill();
  }
  if (d.tail === 'spiked') {
    c.fillStyle = BONE;
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI * 0.35 - i * 0.5;
      spike(c, endX + i * 2, endY + i * 2, len * 0.22, len * 0.08, a, 0.2);
      c.fill();
      ink(c, 0.9);
    }
  }
}

function drawDorsalSpikes(c: Ctx, d: CreatureDesign, x0: number, y0: number, x1: number, y1: number, size: number) {
  if (d.spikes <= 0) return;
  const n = d.spikes;
  c.fillStyle = linGrad(c, x0, y0 - size, x1, y1, [
    [0, lighten(d.accent, 0.3)],
    [1, darken(d.main, 0.5)]
  ]);
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    const px = x0 + (x1 - x0) * k;
    const py = y0 + (y1 - y0) * k;
    const h = size * (0.6 + Math.sin(k * Math.PI) * 0.7);
    spike(c, px, py, h, size * 0.32, -Math.PI / 2 - 0.35, 0.18);
    c.fill();
    ink(c, 0.9);
  }
}

function drawAura(c: Ctx, d: CreatureDesign, an: Anim, w: number, h: number) {
  const col = AURA_COLOR[d.aura];
  if (!col) return;
  c.save();
  c.globalCompositeOperation = 'lighter';
  const pulse = 0.55 + Math.sin(an.t * 2.2 + d.seed) * 0.18;
  if (d.aura === 'fire' || d.aura === 'blood') {
    for (let i = 0; i < 5; i++) {
      const p = ((an.t * 0.7 + i / 5) % 1);
      const fx = (rand01(d.seed, i) - 0.5) * w * 1.3;
      const fy = -p * h * 1.15;
      const r = (1 - p) * w * 0.28 + 3;
      c.fillStyle = radGrad(c, fx, fy, 0, fx, fy, r, [
        [0, alpha(col, 0.5 * (1 - p))],
        [1, alpha(col, 0)]
      ]);
      c.beginPath();
      c.arc(fx, fy, r, 0, TAU);
      c.fill();
    }
  } else if (d.aura === 'frost') {
    c.strokeStyle = alpha(col, 0.5 * pulse);
    c.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + an.t * 0.4;
      const rx = Math.cos(a) * w * 0.85;
      const ry = -h * 0.45 + Math.sin(a) * h * 0.4;
      c.beginPath();
      c.moveTo(rx - 3, ry);
      c.lineTo(rx + 3, ry);
      c.moveTo(rx, ry - 3);
      c.lineTo(rx, ry + 3);
      c.stroke();
    }
  } else if (d.aura === 'storm') {
    if (Math.sin(an.t * 9 + d.seed) > 0.72) {
      c.strokeStyle = alpha(col, 0.85);
      c.lineWidth = 2;
      c.beginPath();
      let lx = (rand01(d.seed, (an.t * 3) | 0) - 0.5) * w;
      let ly = -h;
      c.moveTo(lx, ly);
      for (let i = 0; i < 4; i++) {
        lx += (Math.random() - 0.5) * w * 0.5;
        ly += h * 0.25;
        c.lineTo(lx, ly);
      }
      c.stroke();
    }
  }
  c.fillStyle = radGrad(c, 0, -h * 0.45, h * 0.1, 0, -h * 0.45, h * 0.9, [
    [0, alpha(col, 0.16 * pulse)],
    [1, alpha(col, 0)]
  ]);
  c.beginPath();
  c.ellipse(0, -h * 0.45, w * 1.15, h * 0.75, 0, 0, TAU);
  c.fill();
  c.restore();
}

/* ------------------------------------------------------------ archetypes -- */

function bodyLimb(c: Ctx, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, w: number, fill: string | CanvasGradient) {
  jointLimb(c, x0, y0, x1, y1, x2, y2, w, w * 0.75, w * 0.55, fill);
}

function drawBeast(c: Ctx, d: CreatureDesign, an: Anim, U: number) {
  const s = skinOf(d);
  const bodyY = -U * 0.5;
  const bw = U * 0.52 * d.bulk;
  const bh = U * 0.3 * d.bulk;
  const step = Math.sin(an.limbPhase);
  const backFill = linGrad(c, 0, bodyY - bh, 0, 0, [[0, s.dark], [1, darken(s.dark, 0.3)]]);
  const frontFill = linGrad(c, 0, bodyY - bh, 0, 0, [[0, s.mat.base], [1, s.dark]]);

  drawTail(c, d, -bw * 0.95, bodyY - bh * 0.2, U * 0.5, an);
  // back legs
  bodyLimb(c, -bw * 0.6, bodyY, -bw * 0.75 + step * 4, bodyY + U * 0.24, -bw * 0.62 + step * 7, -1, U * 0.13, backFill);
  bodyLimb(c, bw * 0.55, bodyY, bw * 0.62 - step * 4, bodyY + U * 0.24, bw * 0.7 - step * 7, -1, U * 0.13, backFill);
  if (d.wings !== 'none') drawWings(c, d, -bw * 0.1, bodyY - bh * 0.7, U * 0.6, an, true);

  // barrel
  shadedEllipse(c, 0, bodyY, bw, bh, s.mat);
  c.fillStyle = alpha(s.belly, 0.5);
  c.beginPath();
  c.ellipse(bw * 0.05, bodyY + bh * 0.42, bw * 0.72, bh * 0.42, 0, 0, Math.PI);
  c.fill();
  if (d.plates) {
    c.strokeStyle = alpha(s.dark, 0.7);
    c.lineWidth = 1.4;
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.ellipse(i * bw * 0.35, bodyY, bw * 0.14, bh * 0.92, 0, -Math.PI * 0.9, Math.PI * 0.1);
      c.stroke();
    }
  }
  drawDorsalSpikes(c, d, -bw * 0.6, bodyY - bh * 0.88, bw * 0.5, bodyY - bh * 0.8, U * 0.13);

  // front legs
  bodyLimb(c, -bw * 0.35, bodyY + bh * 0.4, -bw * 0.42 - step * 4, bodyY + U * 0.26, -bw * 0.34 - step * 7, -1, U * 0.125, frontFill);
  bodyLimb(c, bw * 0.62, bodyY + bh * 0.2, bw * 0.7 + step * 4, bodyY + U * 0.26, bw * 0.66 + step * 7, -1, U * 0.135, frontFill);

  // neck + head
  const hx = bw * 0.95;
  const hy = bodyY - bh * 0.75 + an.headDrop + an.breathe * 1.2;
  c.fillStyle = frontFill;
  limb(c, bw * 0.5, bodyY - bh * 0.3, hx, hy, U * 0.24 * d.bulk, U * 0.2);
  c.fill();
  ink(c, 1.5);
  if (d.mane) {
    c.fillStyle = linGrad(c, hx - U * 0.4, hy - U * 0.3, hx, hy + U * 0.2, [[0, s.light], [1, s.dark]]);
    c.beginPath();
    const R = U * 0.34 * d.bulk;
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI * 0.85 + (i / 12) * Math.PI * 1.7;
      const k = R * (i % 2 === 0 ? 1.28 : 0.98);
      const px = hx - U * 0.12 + Math.cos(a) * k;
      const py = hy + Math.sin(a) * k * 0.95;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
    ink(c, 1.3);
  }
  const hr = U * 0.22;
  shadedEllipse(c, hx, hy, hr * 1.05, hr * 0.92, s.mat);
  // snout
  c.fillStyle = s.mat.base;
  c.beginPath();
  c.ellipse(hx + hr * 0.85, hy + hr * 0.3, hr * 0.55, hr * 0.4, 0.1, 0, TAU);
  c.fill();
  ink(c, 1.3);
  c.fillStyle = darken(s.dark, 0.3);
  c.beginPath();
  c.ellipse(hx + hr * 1.3, hy + hr * 0.16, hr * 0.16, hr * 0.12, 0, 0, TAU);
  c.fill();
  // ears
  c.fillStyle = s.dark;
  for (const sg of [-1, 1]) {
    c.beginPath();
    c.moveTo(hx - hr * 0.3, hy - hr * 0.7);
    c.quadraticCurveTo(hx - hr * (0.6 + sg * 0.25), hy - hr * 1.75, hx + hr * 0.15 * sg, hy - hr * 0.85);
    c.closePath();
    c.fill();
    ink(c, 1);
  }
  drawHorns(c, d, hx, hy - hr * 0.4, hr, an);
  drawEyes(c, d, hx + hr * 0.25, hy - hr * 0.2, hr, an);
  drawMaw(c, d, hx + hr * 0.7, hy + hr * 0.5, hr, an.strike * 0.9 + 0.12);
  if (d.wings !== 'none') drawWings(c, d, bw * 0.05, bodyY - bh * 0.85, U * 0.62, an, false);
}

/**
 * A hand weapon in weapon-local space: the hand is at the origin, the grip
 * hangs below it (+y) and the business end runs up -y. The caller rotates it
 * so -y points where the creature is facing.
 */
function drawHeldWeapon(c: Ctx, d: CreatureDesign, U: number) {
  const wm = material(d.boss ? '#c9b06a' : '#9aa5b8', null, 0.9);
  const kind = d.bulk >= 1.4 ? 'axe' : d.size < 0.9 ? 'dagger' : 'sword';
  const len = kind === 'dagger' ? U * 0.3 : kind === 'axe' ? U * 0.58 : U * 0.5;
  const gw = kind === 'dagger' ? 3 : 4.4;
  const metal = linGrad(c, -U * 0.08, -len, U * 0.08, 0, [
    [0, wm.hi],
    [0.5, wm.base],
    [1, wm.lo]
  ]);
  // grip
  c.fillStyle = linGrad(c, -3, 0, 3, U * 0.14, [[0, '#5a4230'], [1, '#2e2016']]);
  c.beginPath();
  c.roundRect(-gw / 2, -U * 0.04, gw, U * 0.16, 2);
  c.fill();
  ink(c, 1);
  if (kind === 'axe') {
    // long haft with a bearded head; the bit faces +x (forward once rotated)
    c.fillStyle = linGrad(c, -2.4, -len, 2.4, 0, [[0, '#6b4a2c'], [1, '#2e2016']]);
    c.beginPath();
    c.roundRect(-2.4, -len, 4.8, len + U * 0.06, 2);
    c.fill();
    ink(c, 1);
    const hy = -len + U * 0.1;
    c.beginPath();
    c.moveTo(-U * 0.02, hy - U * 0.12);
    c.quadraticCurveTo(U * 0.2, hy - U * 0.16, U * 0.24, hy - U * 0.02);
    c.quadraticCurveTo(U * 0.2, hy + U * 0.12, -U * 0.02, hy + U * 0.14);
    c.closePath();
    c.fillStyle = metal;
    c.fill();
    ink(c, 1.3);
    c.strokeStyle = alpha(wm.spec, 0.7);
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(U * 0.2, hy - U * 0.08);
    c.quadraticCurveTo(U * 0.23, hy, U * 0.19, hy + U * 0.08);
    c.stroke();
    return;
  }
  // cross guard
  c.fillStyle = wm.lo;
  c.beginPath();
  c.roundRect(-U * 0.07, -U * 0.065, U * 0.14, U * 0.03, 1.5);
  c.fill();
  ink(c, 1);
  // blade
  const hw = kind === 'dagger' ? U * 0.035 : U * 0.05;
  c.beginPath();
  c.moveTo(-hw, -U * 0.05);
  c.quadraticCurveTo(-hw * 1.05, -len * 0.62, 0, -len);
  c.quadraticCurveTo(hw * 1.05, -len * 0.62, hw, -U * 0.05);
  c.closePath();
  c.fillStyle = metal;
  c.fill();
  ink(c, 1.3);
  c.strokeStyle = alpha(wm.spec, 0.65);
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(-hw * 0.3, -U * 0.08);
  c.quadraticCurveTo(-hw * 0.4, -len * 0.6, 0, -len * 0.92);
  c.stroke();
}

function drawHumanoid(c: Ctx, d: CreatureDesign, an: Anim, U: number) {
  const s = skinOf(d);
  const hipY = -U * 0.44 + an.crouch * 0.3;
  const chestY = -U * 0.76 + an.crouch * 0.2;
  const bw = U * 0.24 * d.bulk;
  const step = Math.sin(an.limbPhase * 0.6) * 0.25;
  const backFill = linGrad(c, 0, chestY, 0, 0, [[0, s.dark], [1, darken(s.dark, 0.3)]]);
  const frontFill = linGrad(c, 0, chestY, 0, 0, [[0, s.light], [1, s.dark]]);

  drawWings(c, d, 0, chestY - U * 0.05, U * 0.7, an, true);
  drawTail(c, d, -bw * 0.7, hipY, U * 0.42, an);
  // legs
  bodyLimb(c, -bw * 0.45, hipY, -bw * 0.6, hipY + U * 0.22, -bw * 0.72 + step * 6, -1, U * 0.14 * d.bulk, backFill);
  bodyLimb(c, bw * 0.45, hipY, bw * 0.58, hipY + U * 0.22, bw * 0.66 - step * 6, -1, U * 0.15 * d.bulk, frontFill);
  // back arm
  const armSw = an.strike * 1.5;
  bodyLimb(c, -bw * 0.75, chestY + U * 0.03, -bw * 1.15, chestY + U * 0.16, -bw * 1.05, chestY + U * 0.3, U * 0.11 * d.bulk, backFill);

  // torso
  c.beginPath();
  c.moveTo(-bw, chestY);
  c.quadraticCurveTo(-bw * 1.16, chestY + U * 0.14, -bw * 0.78, hipY + U * 0.02);
  c.lineTo(bw * 0.78, hipY + U * 0.02);
  c.quadraticCurveTo(bw * 1.16, chestY + U * 0.14, bw, chestY);
  c.quadraticCurveTo(0, chestY - U * 0.07, -bw, chestY);
  c.closePath();
  c.fillStyle = linGrad(c, -bw, chestY, bw, hipY, [
    [0, s.light],
    [0.45, s.mat.base],
    [1, s.dark]
  ]);
  c.fill();
  ink(c, 1.8);
  c.fillStyle = alpha(s.belly, 0.35);
  c.beginPath();
  c.ellipse(bw * 0.1, hipY - U * 0.06, bw * 0.55, U * 0.09, 0, 0, TAU);
  c.fill();
  if (d.plates) {
    c.fillStyle = alpha(darken(s.dark, 0.2), 0.85);
    c.beginPath();
    c.moveTo(-bw * 0.95, chestY + U * 0.02);
    c.quadraticCurveTo(0, chestY + U * 0.12, bw * 0.95, chestY + U * 0.02);
    c.quadraticCurveTo(bw * 0.7, chestY + U * 0.2, 0, chestY + U * 0.22);
    c.quadraticCurveTo(-bw * 0.7, chestY + U * 0.2, -bw * 0.95, chestY + U * 0.02);
    c.closePath();
    c.fill();
    ink(c, 1.2);
  }
  drawDorsalSpikes(c, d, -bw * 0.9, chestY + U * 0.02, -bw * 0.5, hipY, U * 0.11);

  // head
  const hr = U * 0.17 * (1 + (d.bulk - 1) * 0.35);
  const hx = U * 0.03;
  const hy = chestY - hr * 1.15 + an.headDrop + an.breathe * 0.8;
  c.fillStyle = frontFill;
  limb(c, 0, chestY + U * 0.01, hx, hy + hr * 0.7, hr * 0.85, hr * 0.75);
  c.fill();
  if (d.mane) {
    c.fillStyle = s.dark;
    c.beginPath();
    c.ellipse(hx - hr * 0.35, hy + hr * 0.1, hr * 1.35, hr * 1.25, 0, 0, TAU);
    c.fill();
    ink(c, 1.2);
  }
  shadedEllipse(c, hx, hy, hr, hr * 1.08, s.mat);
  // brow ridge
  c.fillStyle = alpha(s.dark, 0.6);
  c.beginPath();
  c.ellipse(hx + hr * 0.15, hy - hr * 0.3, hr * 0.85, hr * 0.28, -0.08, 0, TAU);
  c.fill();
  drawHorns(c, d, hx, hy - hr * 0.55, hr, an);
  drawEyes(c, d, hx + hr * 0.25, hy - hr * 0.05, hr, an);
  drawMaw(c, d, hx + hr * 0.35, hy + hr * 0.45, hr, an.strike * 0.85 + 0.1);
  // ears
  c.fillStyle = s.dark;
  c.beginPath();
  c.moveTo(hx - hr * 0.85, hy - hr * 0.1);
  c.quadraticCurveTo(hx - hr * 1.9, hy - hr * 0.65, hx - hr * 1.5, hy + hr * 0.2);
  c.quadraticCurveTo(hx - hr * 1.15, hy + hr * 0.3, hx - hr * 0.85, hy + hr * 0.2);
  c.closePath();
  c.fill();
  ink(c, 1);

  // front arm (+ weapon): raised and forward at rest, driven forward and
  // down through the strike. Local +x is the facing direction, so the blade
  // always points at whatever the creature is facing — never back at itself.
  const sx = bw * 0.8;
  const sy = chestY + U * 0.02;
  const ang = -0.6 + armSw * 0.9;
  const ex = sx + Math.cos(ang) * U * 0.2;
  const ey = sy + Math.sin(ang) * U * 0.2 + U * 0.12;
  const wx = ex + Math.cos(ang - 0.5) * U * 0.2;
  const wy = ey + Math.sin(ang - 0.5) * U * 0.2 + U * 0.06;
  bodyLimb(c, sx, sy, ex, ey, wx, wy, U * 0.12 * d.bulk, frontFill);
  if (d.armed) {
    c.save();
    c.translate(wx, wy);
    // Blade runs along local -y; 0.55 rad puts it forward-up at rest and the
    // strike sweeps it to forward-down.
    c.rotate(0.55 + armSw * 0.95);
    drawHeldWeapon(c, d, U);
    c.restore();
  } else {
    c.fillStyle = s.mat.base;
    for (let i = -1; i <= 1; i++) {
      spike(c, wx + i * U * 0.03, wy + U * 0.02, U * 0.11, U * 0.035, Math.PI * 0.45 + i * 0.3, 0.2);
      c.fill();
      ink(c, 0.9);
    }
  }
  drawWings(c, d, 0, chestY - U * 0.02, U * 0.72, an, false);
}

function drawUndead(c: Ctx, d: CreatureDesign, an: Anim, U: number) {
  const boneCol = d.main;
  const s = skinOf(d);
  const robe = !!d.accent && /lich|revenant|deathless/.test('') ? d.accent : d.accent;
  const hipY = -U * 0.42 + an.crouch * 0.3;
  const chestY = -U * 0.74;
  const bw = U * 0.2 * d.bulk;
  const hasRobe = d.aura === 'void' || d.armed;
  const bfill = linGrad(c, -bw, chestY, bw, 0, [
    [0, lighten(boneCol, 0.2)],
    [1, darken(boneCol, 0.4)]
  ]);

  // legs
  bodyLimb(c, -bw * 0.5, hipY, -bw * 0.7, hipY + U * 0.2, -bw * 0.8, -1, U * 0.075, bfill);
  bodyLimb(c, bw * 0.5, hipY, bw * 0.62, hipY + U * 0.2, bw * 0.7, -1, U * 0.08, bfill);

  if (hasRobe) {
    const rc = d.accent && d.accent !== boneCol ? d.accent : '#3a3350';
    c.fillStyle = linGrad(c, -bw * 1.6, chestY, bw * 1.6, 2, [
      [0, lighten(rc, 0.2)],
      [0.6, rc],
      [1, darken(rc, 0.5)]
    ]);
    c.beginPath();
    c.moveTo(-bw * 0.95, chestY - U * 0.02);
    c.quadraticCurveTo(-bw * 1.9, hipY, -bw * 1.75, -1);
    for (let i = 0; i < 5; i++) {
      const px = -bw * 1.75 + (i / 4) * bw * 3.5;
      c.lineTo(px + bw * 0.2, -1 - (i % 2) * U * 0.05);
    }
    c.quadraticCurveTo(bw * 1.9, hipY, bw * 0.95, chestY - U * 0.02);
    c.closePath();
    c.fill();
    ink(c, 1.6);
  }

  // rib cage
  c.fillStyle = bfill;
  c.beginPath();
  c.moveTo(-bw, chestY);
  c.quadraticCurveTo(-bw * 1.1, chestY + U * 0.16, -bw * 0.45, hipY);
  c.lineTo(bw * 0.45, hipY);
  c.quadraticCurveTo(bw * 1.1, chestY + U * 0.16, bw, chestY);
  c.closePath();
  c.fill();
  ink(c, 1.6);
  c.strokeStyle = alpha(darken(boneCol, 0.55), 0.85);
  c.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const ry = chestY + U * 0.05 + i * U * 0.055;
    c.beginPath();
    c.moveTo(-bw * (0.95 - i * 0.1), ry);
    c.quadraticCurveTo(0, ry + U * 0.045, bw * (0.95 - i * 0.1), ry);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(0, chestY + U * 0.02);
  c.lineTo(0, hipY - U * 0.01);
  c.stroke();

  // skull
  const hr = U * 0.17;
  const hx = 0;
  const hy = chestY - hr * 1.25 + an.headDrop;
  c.fillStyle = bfill;
  c.beginPath();
  c.roundRect(-hr * 0.22, chestY - hr * 0.7, hr * 0.44, hr * 0.8, hr * 0.2);
  c.fill();
  c.beginPath();
  c.moveTo(-hr, hy + hr * 0.15);
  c.quadraticCurveTo(-hr * 1.05, hy - hr, 0, hy - hr * 1.05);
  c.quadraticCurveTo(hr * 1.05, hy - hr, hr, hy + hr * 0.15);
  c.quadraticCurveTo(hr * 0.95, hy + hr * 0.55, hr * 0.5, hy + hr * 0.62);
  c.lineTo(hr * 0.45, hy + hr * 1.05);
  c.quadraticCurveTo(0, hy + hr * 1.3, -hr * 0.45, hy + hr * 1.0);
  c.lineTo(-hr * 0.5, hy + hr * 0.62);
  c.quadraticCurveTo(-hr * 0.95, hy + hr * 0.55, -hr, hy + hr * 0.15);
  c.closePath();
  c.fillStyle = radGrad(c, hx - hr * 0.3, hy - hr * 0.4, 1, hx, hy, hr * 1.7, [
    [0, lighten(boneCol, 0.25)],
    [1, darken(boneCol, 0.35)]
  ]);
  c.fill();
  ink(c, 1.6);
  // eye sockets
  for (const sg of [-1, 1]) {
    c.fillStyle = '#0a0c16';
    c.beginPath();
    c.ellipse(hx + sg * hr * 0.42, hy - hr * 0.1, hr * 0.3, hr * 0.34, 0, 0, TAU);
    c.fill();
  }
  if (d.glowEyes && an.eyeSquint < 0.95) {
    for (const sg of [-1, 1]) eye(c, hx + sg * hr * 0.42 + hr * 0.06, hy - hr * 0.08, hr * 0.14, d.eyeColor, an.eyeSquint);
  }
  // nasal + teeth
  c.fillStyle = '#0a0c16';
  poly(c, [hx, hy + hr * 0.22, hx + hr * 0.14, hy + hr * 0.52, hx - hr * 0.14, hy + hr * 0.52]);
  c.fill();
  c.strokeStyle = '#0a0c16';
  c.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    c.beginPath();
    c.moveTo(hx + i * hr * 0.17, hy + hr * 0.66);
    c.lineTo(hx + i * hr * 0.17, hy + hr * 1.02);
    c.stroke();
  }
  drawHorns(c, d, hx, hy - hr * 0.75, hr, an);

  // arms
  const armSw = an.strike * 1.4;
  bodyLimb(c, -bw * 0.85, chestY + U * 0.02, -bw * 1.4, chestY + U * 0.14, -bw * 1.25, chestY + U * 0.3, U * 0.07, bfill);
  const sx = bw * 0.85;
  const sy = chestY + U * 0.02;
  const wx = sx + U * 0.22;
  const wy = sy + U * 0.2 - armSw * U * 0.2;
  bodyLimb(c, sx, sy, sx + U * 0.16, sy + U * 0.14, wx, wy, U * 0.075, bfill);
  if (d.armed) {
    c.save();
    c.translate(wx, wy);
    // Staff held upright with the focus on top; the strike tilts it forward
    // so the orb lunges toward the target.
    c.rotate(0.14 + armSw * 0.6);
    c.fillStyle = linGrad(c, -2.5, -U * 0.7, 2.5, U * 0.2, [[0, '#4a3b2c'], [1, '#241a12']]);
    c.beginPath();
    c.roundRect(-2.2, -U * 0.72, 4.4, U * 0.95, 2);
    c.fill();
    ink(c, 1.1);
    // claw cradle for the focus
    c.strokeStyle = '#241a12';
    c.lineWidth = 2;
    c.lineCap = 'round';
    for (const sg of [-1, 1]) {
      c.beginPath();
      c.moveTo(0, -U * 0.68);
      c.quadraticCurveTo(sg * U * 0.08, -U * 0.74, sg * U * 0.05, -U * 0.84);
      c.stroke();
    }
    const gc = d.eyeColor;
    glow(c, 0, -U * 0.78, U * 0.24, gc, 0.7 + an.strike * 0.5);
    c.fillStyle = radGrad(c, -1, -U * 0.8, 0, 0, -U * 0.78, U * 0.07, [
      [0, '#fff'],
      [1, gc]
    ]);
    c.beginPath();
    c.arc(0, -U * 0.78, U * 0.06, 0, TAU);
    c.fill();
    c.restore();
  }
  void robe;
  void s;
}

function drawDragon(c: Ctx, d: CreatureDesign, an: Anim, U: number) {
  const s = skinOf(d);
  const bodyY = -U * 0.52;
  const bw = U * 0.46 * d.bulk;
  const bh = U * 0.3 * d.bulk;
  const step = Math.sin(an.limbPhase * 0.8);
  const backFill = linGrad(c, 0, bodyY - bh, 0, 0, [[0, s.dark], [1, darken(s.dark, 0.35)]]);

  drawTail(c, d, -bw * 0.9, bodyY, U * 0.75, an);
  drawWings(c, d, -bw * 0.1, bodyY - bh * 0.6, U * 0.95, an, true);
  // hind legs
  bodyLimb(c, -bw * 0.45, bodyY + bh * 0.2, -bw * 0.7, bodyY + U * 0.24, -bw * 0.5 + step * 3, -1, U * 0.16, backFill);
  bodyLimb(c, bw * 0.35, bodyY + bh * 0.3, bw * 0.55, bodyY + U * 0.26, bw * 0.72 - step * 3, -1, U * 0.15, backFill);

  shadedEllipse(c, 0, bodyY, bw, bh, s.mat, -0.1);
  // belly plates
  c.save();
  c.beginPath();
  c.ellipse(0, bodyY, bw, bh, -0.1, 0, TAU);
  c.clip();
  c.fillStyle = alpha(s.belly, 0.75);
  for (let i = -3; i <= 3; i++) {
    c.beginPath();
    c.ellipse(i * bw * 0.24, bodyY + bh * 0.6, bw * 0.13, bh * 0.2, 0, 0, TAU);
    c.fill();
  }
  c.restore();
  drawDorsalSpikes(c, d, -bw * 0.75, bodyY - bh * 0.8, bw * 0.55, bodyY - bh * 0.75, U * 0.14);

  // front legs
  const frontFill = linGrad(c, 0, bodyY, 0, 0, [[0, s.light], [1, s.dark]]);
  bodyLimb(c, bw * 0.62, bodyY + bh * 0.15, bw * 0.78, bodyY + U * 0.24, bw * 0.66 + step * 4, -1, U * 0.13, frontFill);

  // neck (S curve) + head high
  const nx0 = bw * 0.55;
  const ny0 = bodyY - bh * 0.5;
  const hx = bw * 1.02;
  const hy = bodyY - U * 0.52 + an.headDrop + an.breathe * 1.6;
  c.fillStyle = frontFill;
  limb(c, nx0, ny0, (nx0 + hx) / 2 + U * 0.06, (ny0 + hy) / 2, U * 0.2 * d.bulk, U * 0.15);
  c.fill();
  ink(c, 1.5);
  limb(c, (nx0 + hx) / 2 + U * 0.06, (ny0 + hy) / 2, hx, hy + U * 0.05, U * 0.15, U * 0.12);
  c.fill();
  ink(c, 1.5);
  drawDorsalSpikes(c, d, nx0, ny0 - U * 0.08, hx - U * 0.05, hy, U * 0.09);

  // head: wedge skull with long jaw
  const hr = U * 0.19;
  c.beginPath();
  c.moveTo(hx - hr * 0.9, hy - hr * 0.3);
  c.quadraticCurveTo(hx - hr * 0.4, hy - hr * 1.15, hx + hr * 0.5, hy - hr * 0.85);
  c.quadraticCurveTo(hx + hr * 1.9, hy - hr * 0.5, hx + hr * 2.0, hy + hr * 0.15);
  c.quadraticCurveTo(hx + hr * 1.2, hy + hr * 0.45, hx + hr * 0.2, hy + hr * 0.62);
  c.quadraticCurveTo(hx - hr * 0.7, hy + hr * 0.6, hx - hr * 0.9, hy - hr * 0.3);
  c.closePath();
  c.fillStyle = linGrad(c, hx - hr, hy - hr, hx + hr * 2, hy + hr, [
    [0, s.light],
    [0.5, s.mat.base],
    [1, s.dark]
  ]);
  c.fill();
  ink(c, 1.7);
  // jaw
  const open = an.strike * 0.8 + 0.1;
  c.save();
  c.translate(hx + hr * 0.15, hy + hr * 0.45);
  c.rotate(open * 0.55);
  c.fillStyle = s.dark;
  c.beginPath();
  c.moveTo(-hr * 0.9, -hr * 0.1);
  c.quadraticCurveTo(hr * 0.6, hr * 0.25, hr * 1.75, -hr * 0.12);
  c.quadraticCurveTo(hr * 0.6, hr * 0.55, -hr * 0.85, hr * 0.3);
  c.closePath();
  c.fill();
  ink(c, 1.4);
  c.fillStyle = BONE;
  for (let i = 0; i < 4; i++) {
    const fx = -hr * 0.3 + i * hr * 0.5;
    poly(c, [fx - hr * 0.07, -hr * 0.05, fx + hr * 0.07, -hr * 0.05, fx, -hr * 0.35]);
    c.fill();
  }
  c.restore();
  c.fillStyle = BONE;
  for (let i = 0; i < 4; i++) {
    const fx = hx + hr * 0.35 + i * hr * 0.45;
    poly(c, [fx - hr * 0.07, hy + hr * 0.4, fx + hr * 0.07, hy + hr * 0.4, fx, hy + hr * 0.72]);
    c.fill();
  }
  // nostril
  c.fillStyle = darken(s.dark, 0.4);
  c.beginPath();
  c.ellipse(hx + hr * 1.65, hy - hr * 0.15, hr * 0.09, hr * 0.07, 0, 0, TAU);
  c.fill();
  drawHorns(c, d, hx - hr * 0.2, hy - hr * 0.7, hr * 1.1, an);
  drawEyes(c, d, hx + hr * 0.55, hy - hr * 0.35, hr, an, 0.5);
  if (an.strike > 0.3 && (d.aura === 'fire' || d.aura === 'void' || d.aura === 'storm')) {
    const col = AURA_COLOR[d.aura];
    glow(c, hx + hr * 2.2, hy + hr * 0.25, U * 0.28 * an.strike, col, an.strike);
  }
  drawWings(c, d, bw * 0.05, bodyY - bh * 0.75, U, an, false);
}

function drawBlobCreature(c: Ctx, d: CreatureDesign, an: Anim, U: number) {
  const s = skinOf(d);
  const w = U * 0.44 * d.bulk;
  const h = U * 0.38;
  const cy = -h;
  const wob = Math.sin(an.t * 2.6 + d.seed) * 0.05;
  c.save();
  c.translate(0, 0);
  blobPath(c, 0, cy, w * (1 + wob), h * (1 - wob), 0.05, an.t * 1.6, 5);
  c.fillStyle = radGrad(c, -w * 0.3, cy - h * 0.4, 2, 0, cy, w * 1.6, [
    [0, lighten(s.mat.base, 0.45)],
    [0.5, s.mat.base],
    [1, s.dark]
  ]);
  c.globalAlpha *= 0.94;
  c.fill();
  ink(c, 1.8);
  c.restore();
  // inner core
  c.save();
  blobPath(c, 0, cy, w * (1 + wob), h * (1 - wob), 0.05, an.t * 1.6, 5);
  c.clip();
  c.fillStyle = alpha(d.accent, 0.35);
  c.beginPath();
  c.ellipse(w * 0.1, cy + h * 0.35, w * 0.5, h * 0.4, 0, 0, TAU);
  c.fill();
  // highlight
  c.fillStyle = alpha('#ffffff', 0.4);
  c.beginPath();
  c.ellipse(-w * 0.35, cy - h * 0.45, w * 0.25, h * 0.16, -0.5, 0, TAU);
  c.fill();
  c.restore();
  drawDorsalSpikes(c, d, -w * 0.5, cy - h * 0.9, w * 0.5, cy - h * 0.9, U * 0.11);
  drawEyes(c, d, 0, cy - h * 0.1, U * 0.3, an, 1.1);
  drawMaw(c, d, 0, cy + h * 0.32, U * 0.28, an.strike * 0.9 + 0.1);
  // drips
  c.fillStyle = alpha(s.mat.base, 0.85);
  for (let i = 0; i < 3; i++) {
    const p = (an.t * 0.5 + i / 3) % 1;
    const dx = (rand01(d.seed, i + 20) - 0.5) * w * 1.4;
    c.beginPath();
    c.ellipse(dx, cy + h * 0.9 + p * h * 0.4, 2.4 * (1 - p), 3.4 * (1 - p), 0, 0, TAU);
    c.fill();
  }
}

function drawConstruct(c: Ctx, d: CreatureDesign, an: Anim, U: number) {
  const s = skinOf(d);
  const bw = U * 0.3 * d.bulk;
  const hipY = -U * 0.4;
  const chestY = -U * 0.78;
  const float = Math.sin(an.t * 1.6) * 1.6;
  const block = (x: number, y: number, w: number, h: number, r: number, tone = s.mat.base) => {
    c.beginPath();
    c.roundRect(x - w / 2, y - h / 2, w, h, r);
    c.fillStyle = linGrad(c, x - w / 2, y - h / 2, x + w / 2, y + h / 2, [
      [0, lighten(tone, 0.28)],
      [0.45, tone],
      [1, darken(tone, 0.42)]
    ]);
    c.fill();
    ink(c, 1.7);
    c.strokeStyle = alpha(darken(tone, 0.5), 0.5);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x - w * 0.3, y - h / 2 + 2);
    c.lineTo(x - w * 0.1, y);
    c.lineTo(x - w * 0.34, y + h * 0.3);
    c.stroke();
  };
  // legs
  block(-bw * 0.5, hipY + U * 0.16, bw * 0.55, U * 0.34, 5, darken(s.mat.base, 0.2));
  block(bw * 0.5, hipY + U * 0.16, bw * 0.6, U * 0.34, 5);
  // torso
  block(0, (hipY + chestY) / 2 + float, bw * 2, U * 0.42, 7);
  // shoulder blocks (floating)
  block(-bw * 1.15, chestY + U * 0.04 + float * 1.4, bw * 0.7, bw * 0.7, 5, darken(s.mat.base, 0.15));
  block(bw * 1.15, chestY + U * 0.02 + float * 1.4, bw * 0.8, bw * 0.8, 5);
  // arms
  block(-bw * 1.2, chestY + U * 0.24 + float, bw * 0.5, U * 0.3, 5, darken(s.mat.base, 0.25));
  block(bw * 1.25, chestY + U * 0.26 + float, bw * 0.55, U * 0.32, 5);
  // fist
  block(bw * 1.3, chestY + U * 0.46 + float, bw * 0.72, bw * 0.6, 5);
  // core
  const gc = d.eyeColor;
  glow(c, 0, (hipY + chestY) / 2 + float, U * 0.24, gc, 0.75 + Math.sin(an.t * 3) * 0.15);
  c.fillStyle = radGrad(c, 0, (hipY + chestY) / 2 + float, 0, 0, (hipY + chestY) / 2 + float, U * 0.08, [
    [0, '#fff'],
    [1, gc]
  ]);
  c.beginPath();
  c.arc(0, (hipY + chestY) / 2 + float, U * 0.07, 0, TAU);
  c.fill();
  // head
  const hr = U * 0.16;
  const hy = chestY - hr * 1.1 + float * 1.6 + an.headDrop;
  block(U * 0.02, hy, hr * 2.1, hr * 1.9, 5);
  drawDorsalSpikes(c, d, -bw * 0.9, chestY - U * 0.02 + float, bw * 0.9, chestY - U * 0.02 + float, U * 0.1);
  drawHorns(c, d, U * 0.02, hy - hr * 0.7, hr, an);
  drawEyes(c, d, U * 0.02 + hr * 0.2, hy, hr, an);
  if (d.wings !== 'none') drawWings(c, d, 0, chestY + float, U * 0.75, an, false);
}

function drawSpectre(c: Ctx, d: CreatureDesign, an: Anim, U: number) {
  const s = skinOf(d);
  const topY = -U * 0.95;
  const w = U * 0.3 * d.bulk;
  const sway = Math.sin(an.t * 1.5 + d.seed) * U * 0.05;
  const float = Math.sin(an.t * 1.2) * U * 0.03;
  c.save();
  c.globalAlpha *= 0.9;
  drawWings(c, d, 0, topY + U * 0.3, U * 0.8, an, true);
  // wispy body
  c.beginPath();
  c.moveTo(-w, topY + U * 0.28 + float);
  c.quadraticCurveTo(-w * 1.5, topY + U * 0.6, -w * 0.55 + sway, topY + U * 0.85);
  for (let i = 0; i < 4; i++) {
    const px = -w * 0.55 + sway + (i / 3) * w * 1.1;
    c.quadraticCurveTo(px + w * 0.12, topY + U * 0.95 + Math.sin(an.t * 3 + i) * 3, px + w * 0.28, topY + U * 0.86);
  }
  c.quadraticCurveTo(w * 1.5, topY + U * 0.6, w, topY + U * 0.28 + float);
  c.quadraticCurveTo(0, topY + U * 0.1, -w, topY + U * 0.28 + float);
  c.closePath();
  c.fillStyle = linGrad(c, 0, topY, 0, topY + U * 0.95, [
    [0, alpha(lighten(s.mat.base, 0.3), 0.95)],
    [0.5, alpha(s.mat.base, 0.85)],
    [1, alpha(s.dark, 0.15)]
  ]);
  c.fill();
  ink(c, 1.4, alpha(darken(s.dark, 0.2), 0.5));

  // shoulders / hood
  const hr = U * 0.19;
  const hy = topY + hr * 0.9 + float + an.headDrop;
  c.fillStyle = linGrad(c, 0, hy - hr, 0, hy + hr * 1.6, [
    [0, lighten(s.mat.base, 0.35)],
    [1, darken(s.mat.base, 0.3)]
  ]);
  c.beginPath();
  c.moveTo(-hr * 1.35, hy + hr * 1.5);
  c.quadraticCurveTo(-hr * 1.5, hy - hr * 1.1, 0, hy - hr * 1.35);
  c.quadraticCurveTo(hr * 1.5, hy - hr * 1.1, hr * 1.35, hy + hr * 1.5);
  c.quadraticCurveTo(0, hy + hr * 1.0, -hr * 1.35, hy + hr * 1.5);
  c.closePath();
  c.fill();
  ink(c, 1.5);
  // dark void inside the hood
  c.fillStyle = 'rgba(6,7,16,0.88)';
  c.beginPath();
  c.ellipse(hr * 0.1, hy + hr * 0.12, hr * 0.86, hr * 1.0, 0, 0, TAU);
  c.fill();
  drawEyes(c, d, hr * 0.15, hy, hr * 1.05, an, 0.9);
  if (d.maw !== 'none') drawMaw(c, d, hr * 0.1, hy + hr * 0.55, hr * 0.8, an.strike * 0.9 + 0.25);
  drawHorns(c, d, hr * 0.05, hy - hr * 0.95, hr, an);

  // arms
  const armY = hy + hr * 1.7;
  const reach = an.strike * U * 0.12;
  for (const sg of [-1, 1]) {
    c.fillStyle = alpha(s.mat.base, 0.85);
    limb(c, sg * hr * 1.1, armY, sg * (w * 1.25 + reach), armY + U * 0.16 - reach, U * 0.1, U * 0.05);
    c.fill();
    // claw fingers
    c.strokeStyle = alpha(lighten(s.mat.base, 0.4), 0.9);
    c.lineWidth = 1.6;
    c.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(sg * (w * 1.25 + reach), armY + U * 0.16 - reach);
      c.lineTo(sg * (w * 1.25 + reach) + i * U * 0.03, armY + U * 0.26 - reach);
      c.stroke();
    }
  }
  if (d.armed) {
    // Spectral scythe in the leading hand: haft upright, blade hooking
    // forward (+x) over the target, swung down on the strike.
    const hx0 = w * 1.25 + reach;
    const hy0 = armY + U * 0.16 - reach;
    c.save();
    c.translate(hx0, hy0);
    c.rotate(0.3 + an.strike * 0.9);
    c.fillStyle = linGrad(c, -2.4, -U * 0.8, 2.4, U * 0.3, [[0, '#4a4262'], [1, '#1c1828']]);
    c.beginPath();
    c.roundRect(-2.4, -U * 0.8, 4.8, U * 1.1, 2);
    c.fill();
    ink(c, 1.1);
    const bc = lighten(d.eyeColor, 0.2);
    c.fillStyle = linGrad(c, 0, -U * 0.85, U * 0.4, -U * 0.55, [
      [0, lighten(bc, 0.4)],
      [1, alpha(bc, 0.7)]
    ]);
    spike(c, 0, -U * 0.76, U * 0.46, U * 0.1, 0.12, -0.42);
    c.fill();
    ink(c, 1.2, alpha(darken(bc, 0.5), 0.8));
    glow(c, U * 0.2, -U * 0.72, U * 0.22, d.eyeColor, 0.5 + an.strike * 0.4);
    c.restore();
  }
  c.restore();
  glow(c, 0, topY + U * 0.4, U * 0.6, d.eyeColor, 0.22);
}

function drawInsect(c: Ctx, d: CreatureDesign, an: Anim, U: number) {
  const s = skinOf(d);
  const bodyY = -U * 0.4;
  const bw = U * 0.3 * d.bulk;
  const step = Math.sin(an.limbPhase);
  // legs: 3 pairs
  c.strokeStyle = darken(s.dark, 0.15);
  c.lineWidth = U * 0.035;
  c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const ox = -bw * 0.4 + i * bw * 0.5;
    const ph = step * (i % 2 === 0 ? 1 : -1);
    for (const sg of [-1, 1]) {
      c.beginPath();
      c.moveTo(ox, bodyY + U * 0.02);
      c.lineTo(ox + sg * bw * 0.7, bodyY - U * 0.1 + ph * 2);
      c.lineTo(ox + sg * bw * 0.95 + ph * 3, -1);
      c.stroke();
    }
  }
  // abdomen
  shadedEllipse(c, -bw * 0.7, bodyY - U * 0.04, bw * 0.62, bw * 0.5, s.mat);
  c.strokeStyle = alpha(s.dark, 0.7);
  c.lineWidth = 1.3;
  for (let i = -1; i <= 1; i++) {
    c.beginPath();
    c.ellipse(-bw * 0.7 + i * bw * 0.2, bodyY - U * 0.04, bw * 0.12, bw * 0.46, 0, 0, TAU);
    c.stroke();
  }
  // thorax
  shadedEllipse(c, bw * 0.1, bodyY - U * 0.02, bw * 0.5, bw * 0.42, s.mat);
  drawDorsalSpikes(c, d, -bw * 0.9, bodyY - bw * 0.5, bw * 0.4, bodyY - bw * 0.45, U * 0.09);
  drawWings(c, d, 0, bodyY - bw * 0.4, U * 0.6, an, false);
  // head
  const hr = U * 0.17;
  const hx = bw * 0.78;
  const hy = bodyY - U * 0.02 + an.headDrop;
  shadedEllipse(c, hx, hy, hr, hr * 0.88, s.mat);
  // antennae
  c.strokeStyle = s.dark;
  c.lineWidth = 1.6;
  for (const sg of [-1, 1]) {
    c.beginPath();
    c.moveTo(hx + hr * 0.3, hy - hr * 0.5);
    c.quadraticCurveTo(hx + hr * 1.2, hy - hr * (1.6 + sg * 0.4), hx + hr * 1.9, hy - hr * (1.1 + sg * 0.5));
    c.stroke();
  }
  drawEyes(c, d, hx + hr * 0.2, hy - hr * 0.15, hr, an, 0.9);
  drawMaw(c, d, hx + hr * 0.35, hy + hr * 0.35, hr, an.strike * 0.9 + 0.2);
}

function drawBird(c: Ctx, d: CreatureDesign, an: Anim, U: number) {
  const s = skinOf(d);
  const flying = d.wings === 'bat' || d.aura === 'fire';
  const hover = flying ? Math.sin(an.t * 3.4) * U * 0.05 : 0;
  const bodyY = (flying ? -U * 0.55 : -U * 0.46) + hover;
  const bw = U * 0.26 * d.bulk;
  const bh = U * 0.3 * d.bulk;
  drawWings(c, d, -bw * 0.2, bodyY - bh * 0.3, U * 0.75, an, true);
  drawTail(c, d, -bw * 0.7, bodyY + bh * 0.5, U * 0.45, an);
  if (!flying) {
    c.strokeStyle = '#c9922f';
    c.lineWidth = U * 0.035;
    c.lineCap = 'round';
    for (const sg of [-1, 1]) {
      c.beginPath();
      c.moveTo(sg * bw * 0.25, bodyY + bh * 0.6);
      c.lineTo(sg * bw * 0.35, -U * 0.1);
      c.lineTo(sg * bw * 0.2, -1);
      c.stroke();
      c.beginPath();
      c.moveTo(sg * bw * 0.2, -1);
      c.lineTo(sg * bw * 0.2 + bw * 0.3, -1);
      c.stroke();
    }
  } else {
    // tucked talons
    c.strokeStyle = '#c9922f';
    c.lineWidth = U * 0.03;
    for (const sg of [-1, 1]) {
      c.beginPath();
      c.moveTo(sg * bw * 0.25, bodyY + bh * 0.6);
      c.quadraticCurveTo(sg * bw * 0.5, bodyY + bh * 1.1, sg * bw * 0.15, bodyY + bh * 1.3);
      c.stroke();
    }
  }
  // body
  shadedEllipse(c, 0, bodyY, bw, bh, s.mat, -0.15);
  if (d.mane) {
    c.fillStyle = alpha(lighten(s.mat.base, 0.35), 0.85);
    c.beginPath();
    c.ellipse(bw * 0.3, bodyY - bh * 0.5, bw * 0.6, bh * 0.4, -0.3, 0, TAU);
    c.fill();
  }
  // head
  const hr = U * 0.15;
  const hx = bw * 0.75;
  const hy = bodyY - bh * 0.75 + an.headDrop;
  c.fillStyle = linGrad(c, hx - hr, hy, hx, bodyY, [[0, s.mat.base], [1, s.dark]]);
  limb(c, bw * 0.25, bodyY - bh * 0.4, hx, hy + hr * 0.5, hr * 1.1, hr * 0.95);
  c.fill();
  ink(c, 1.4);
  shadedEllipse(c, hx, hy, hr, hr * 0.95, s.mat);
  drawHorns(c, d, hx, hy - hr * 0.6, hr, an);
  drawEyes(c, d, hx + hr * 0.15, hy - hr * 0.1, hr, an, 0.7);
  drawMaw(c, d, hx + hr * 0.5, hy + hr * 0.12, hr, an.strike * 0.7 + 0.05);
  drawWings(c, d, bw * 0.1, bodyY - bh * 0.35, U * 0.8, an, false);
}

function drawSerpent(c: Ctx, d: CreatureDesign, an: Anim, U: number) {
  const s = skinOf(d);
  const coilY = -U * 0.24;
  const cw = U * 0.5 * d.bulk;
  // coiled base
  c.fillStyle = linGrad(c, -cw, coilY - U * 0.2, cw, 0, [
    [0, s.mat.base],
    [1, s.dark]
  ]);
  c.beginPath();
  c.ellipse(0, coilY, cw, U * 0.22, 0, 0, TAU);
  c.fill();
  ink(c, 1.7);
  c.strokeStyle = alpha(s.dark, 0.6);
  c.lineWidth = 1.4;
  for (let i = -2; i <= 2; i++) {
    c.beginPath();
    c.ellipse(i * cw * 0.3, coilY, cw * 0.15, U * 0.2, 0, -Math.PI, 0);
    c.stroke();
  }
  c.fillStyle = alpha(s.belly, 0.6);
  c.beginPath();
  c.ellipse(0, coilY + U * 0.1, cw * 0.85, U * 0.09, 0, 0, TAU);
  c.fill();

  const n = Math.max(1, d.heads);
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    const spread = (k - 0.5) * 2;
    const baseX = spread * cw * 0.5;
    const phase = an.t * 1.8 + i * 1.3 + d.seed;
    const topY = coilY - U * (0.42 + Math.abs(0.5 - Math.abs(spread) * 0.5) * 0.28) - Math.sin(phase) * U * 0.04;
    const hx = baseX + spread * U * 0.2 + Math.sin(phase) * U * 0.03 + (i === n - 1 || n === 1 ? U * 0.1 : 0);
    const hy = topY + an.headDrop * (i === 0 ? 1 : 0.4);
    const neckW = U * 0.14 * d.bulk / Math.sqrt(n) + U * 0.03;
    c.fillStyle = linGrad(c, baseX, coilY, hx, hy, [
      [0, s.dark],
      [1, s.mat.base]
    ]);
    limb(c, baseX, coilY - U * 0.08, (baseX + hx) / 2 - spread * U * 0.06, (coilY + hy) / 2, neckW * 1.25, neckW);
    c.fill();
    ink(c, 1.4);
    limb(c, (baseX + hx) / 2 - spread * U * 0.06, (coilY + hy) / 2, hx, hy + U * 0.06, neckW, neckW * 0.8);
    c.fill();
    ink(c, 1.4);
    if (d.spikes > 0) drawDorsalSpikes(c, { ...d, spikes: 3 }, baseX, coilY - U * 0.1, hx - U * 0.02, hy, U * 0.055);
    // head
    const hr = U * 0.13 / Math.sqrt(n) + U * 0.045;
    c.beginPath();
    c.moveTo(hx - hr, hy - hr * 0.2);
    c.quadraticCurveTo(hx - hr * 0.3, hy - hr * 1.1, hx + hr * 0.7, hy - hr * 0.75);
    c.quadraticCurveTo(hx + hr * 1.85, hy - hr * 0.35, hx + hr * 1.85, hy + hr * 0.25);
    c.quadraticCurveTo(hx + hr * 0.6, hy + hr * 0.72, hx - hr * 0.85, hy + hr * 0.5);
    c.closePath();
    c.fillStyle = linGrad(c, hx - hr, hy - hr, hx + hr * 1.8, hy + hr, [
      [0, s.light],
      [0.5, s.mat.base],
      [1, s.dark]
    ]);
    c.fill();
    ink(c, 1.5);
    // jaw
    const open = an.strike * 0.7 + 0.08;
    c.save();
    c.translate(hx + hr * 0.1, hy + hr * 0.42);
    c.rotate(open * 0.6);
    c.fillStyle = s.dark;
    c.beginPath();
    c.moveTo(-hr * 0.85, -hr * 0.08);
    c.quadraticCurveTo(hr * 0.5, hr * 0.2, hr * 1.6, -hr * 0.1);
    c.quadraticCurveTo(hr * 0.5, hr * 0.5, -hr * 0.8, hr * 0.28);
    c.closePath();
    c.fill();
    ink(c, 1.2);
    c.restore();
    c.fillStyle = BONE;
    for (let f = 0; f < 3; f++) {
      const fx = hx + hr * 0.4 + f * hr * 0.45;
      poly(c, [fx - hr * 0.08, hy + hr * 0.36, fx + hr * 0.08, hy + hr * 0.36, fx, hy + hr * 0.72]);
      c.fill();
    }
    // eye
    if (d.glowEyes) eye(c, hx + hr * 0.5, hy - hr * 0.35, hr * 0.2, d.eyeColor, an.eyeSquint);
    else toonEye(c, hx + hr * 0.5, hy - hr * 0.35, hr * 0.22, 1, 0.7);
    // frill for the lead head
    if (i === Math.floor(n / 2) && d.horns !== 'none') drawHorns(c, d, hx, hy - hr * 0.7, hr, an);
  }
}

/* ------------------------------------------------------------------ main -- */

const DRAWERS: Record<Archetype, (c: Ctx, d: CreatureDesign, an: Anim, U: number) => void> = {
  beast: drawBeast,
  humanoid: drawHumanoid,
  undead: drawUndead,
  dragon: drawDragon,
  blob: drawBlobCreature,
  construct: drawConstruct,
  spectre: drawSpectre,
  insect: drawInsect,
  bird: drawBird,
  serpent: drawSerpent
};

/** Approximate silhouette height in local units, for portrait framing. */
export function creatureHeight(d: CreatureDesign): number {
  return 80 * d.size;
}

export function drawCreatureBody(c: Ctx, id: string, pose: CreaturePose, opts: DrawOpts) {
  const d = creatureDesign(id);
  const an = buildAnim(pose, opts.time, d.seed);
  const U = 80 * d.size;
  const w = U * 0.55 * d.bulk;

  c.save();
  if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;

  groundShadow(c, w * (d.boss ? 1.25 : 1), w * 0.24, d.boss ? 0.55 : 0.44);
  if (d.boss) {
    // menacing ground rune
    c.save();
    c.globalCompositeOperation = 'lighter';
    const col = AURA_COLOR[d.aura] || d.eyeColor;
    c.strokeStyle = alpha(col, 0.28 + Math.sin(opts.time * 2) * 0.08);
    c.lineWidth = 1.6;
    c.beginPath();
    c.ellipse(0, 0, w * 1.15, w * 0.26, 0, 0, TAU);
    c.stroke();
    c.beginPath();
    c.ellipse(0, 0, w * 0.85, w * 0.19, 0, 0, TAU);
    c.stroke();
    c.restore();
  }

  if (d.aura !== 'none') drawAura(c, d, an, w, U);

  c.translate(an.lunge, an.crouch);
  if (an.rot) {
    c.translate(0, 0);
    c.rotate(an.rot);
  }
  c.scale(an.squashX, an.squashY);

  DRAWERS[d.arch](c, d, an, U);

  // boss rim light — separates them from the background
  if (d.boss) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    rimArc(c, 0, -U * 0.5, w * 0.95, U * 0.5, Math.PI * 1.05, Math.PI * 1.75, AURA_COLOR[d.aura] || d.eyeColor, 2.4, 0.3);
    c.restore();
  }

  c.restore();

  if (opts.flash) {
    c.save();
    c.globalCompositeOperation = 'source-atop';
    c.globalAlpha = clamp(opts.flash, 0, 1) * 0.85;
    c.fillStyle = '#fff';
    c.fillRect(-w * 2, -U * 1.6, w * 4, U * 1.7);
    c.restore();
  }
}

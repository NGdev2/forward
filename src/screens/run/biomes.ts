/* ============================================================================
 * Biome palettes. The world cycle picks one, so beating a boss visibly moves
 * the run into new country.
 *
 * Ordered gentle → hostile: the first cycles are meadows and shores, the last
 * are lava fields and the void. `biomeFor` wraps, so a long run tours them.
 *
 * The combat arena consumes skyTop/skyBottom/sun/sunGlow/hillFar/hillNear/
 * fog/ground/groundB/ambientColor/stars — keep those names stable.
 * ========================================================================== */

export type SceneryKind =
  | 'tree'
  | 'pine'
  | 'rock'
  | 'cactus'
  | 'crystal'
  | 'ruin'
  | 'bone'
  | 'mushroom'
  | 'willow'
  | 'reed'
  | 'peak'
  | 'banner'
  | 'icespike'
  | 'lavarock'
  | 'geyser'
  | 'sakura'
  | 'lantern'
  | 'palm'
  | 'wreck'
  | 'deadtree'
  | 'totem';

export type AmbientKind =
  | 'none'
  | 'leaf'
  | 'snow'
  | 'ember'
  | 'dust'
  | 'spore'
  | 'firefly'
  | 'mist'
  | 'wind'
  | 'ash'
  | 'petal'
  | 'rain'
  | 'wisp';

export interface Biome {
  id: string;
  name: string;
  /** One short line shown as a toast when the road enters this biome. */
  flavor: string;
  skyTop: string;
  skyBottom: string;
  sun: string;
  sunGlow: string;
  hillFar: string;
  hillNear: string;
  fog: string;
  roadA: string;
  roadB: string;
  roadEdge: string;
  stripe: string;
  ground: string;
  groundB: string;
  /** Light colour washed over the road (rgba, keep the alpha subtle). */
  tint: string;
  scenery: SceneryKind[];
  sceneryA: string;
  sceneryB: string;
  ambient: AmbientKind;
  ambientColor: string;
  stars: boolean;
  /** Occasional sky-wide lightning flashes. */
  lightning?: boolean;
}

export const BIOMES: Biome[] = [
  {
    id: 'greenway',
    name: 'The Greenway',
    flavor: 'Soft hills, an easy road. It will not last.',
    skyTop: '#0d1b3a', skyBottom: '#4a6ea8',
    sun: '#ffd9a0', sunGlow: 'rgba(255,196,120,0.35)',
    hillFar: '#26406b', hillNear: '#1b2c4d',
    fog: 'rgba(112,152,206,0.55)',
    roadA: '#3a3f52', roadB: '#333849', roadEdge: '#8fa3c9', stripe: '#e9edf8',
    ground: '#1f3a2c', groundB: '#274634',
    tint: 'rgba(120,200,150,0.14)',
    scenery: ['tree', 'pine', 'rock'], sceneryA: '#173427', sceneryB: '#2c5a3d',
    ambient: 'leaf', ambientColor: '#7fc98a', stars: false
  },
  {
    id: 'bloomvale',
    name: 'Bloomvale',
    flavor: 'Petals on the wind. Lanterns lit for no one.',
    skyTop: '#2a2a5c', skyBottom: '#f0a8b8',
    sun: '#fff0d8', sunGlow: 'rgba(255,200,210,0.45)',
    hillFar: '#6a4a7a', hillNear: '#4a3560',
    fog: 'rgba(240,180,200,0.5)',
    roadA: '#4a4050', roadB: '#413846', roadEdge: '#e8b8c8', stripe: '#fff0f4',
    ground: '#3a5a3a', groundB: '#4a6a44',
    tint: 'rgba(255,170,200,0.18)',
    scenery: ['sakura', 'lantern', 'tree'], sceneryA: '#3a2a2a', sceneryB: '#ff9ec2',
    ambient: 'petal', ambientColor: '#ffb8d0', stars: false
  },
  {
    id: 'sunsands',
    name: 'The Sunsands',
    flavor: 'Heat shimmer and bones. Bring water.',
    skyTop: '#1a3358', skyBottom: '#e2b56a',
    sun: '#fff2c0', sunGlow: 'rgba(255,220,140,0.45)',
    hillFar: '#a8814c', hillNear: '#7c5c34',
    fog: 'rgba(226,190,130,0.55)',
    roadA: '#5a4a38', roadB: '#4f4131', roadEdge: '#ffe0a0', stripe: '#fff4d6',
    ground: '#c9a566', groundB: '#b8934f',
    tint: 'rgba(255,210,120,0.2)',
    scenery: ['cactus', 'rock', 'bone'], sceneryA: '#6b4f2c', sceneryB: '#3f7a4a',
    ambient: 'dust', ambientColor: '#e8cf9a', stars: false
  },
  {
    id: 'mirewood',
    name: 'Mirewood',
    flavor: 'The road sinks a little with every step.',
    skyTop: '#0c1a18', skyBottom: '#3d6a5a',
    sun: '#d8ffb0', sunGlow: 'rgba(160,230,150,0.3)',
    hillFar: '#22463c', hillNear: '#162e28',
    fog: 'rgba(120,180,150,0.6)',
    roadA: '#3a3d34', roadB: '#32352d', roadEdge: '#8fb08a', stripe: '#d8e8c8',
    ground: '#1c2e22', groundB: '#22392a',
    tint: 'rgba(90,160,110,0.2)',
    scenery: ['willow', 'reed', 'mushroom'], sceneryA: '#14261f', sceneryB: '#4f8f5a',
    ambient: 'firefly', ambientColor: '#d8ff7a', stars: false
  },
  {
    id: 'frostmarch',
    name: 'The Frostmarch',
    flavor: 'Snow on the road, and nothing else moving.',
    skyTop: '#071429', skyBottom: '#5f86b8',
    sun: '#e8f4ff', sunGlow: 'rgba(190,225,255,0.35)',
    hillFar: '#2b4a72', hillNear: '#1b3050',
    fog: 'rgba(190,220,255,0.5)',
    roadA: '#4a5468', roadB: '#414b5e', roadEdge: '#cfe4ff', stripe: '#ffffff',
    ground: '#c8d8ea', groundB: '#b0c4dc',
    tint: 'rgba(180,220,255,0.18)',
    scenery: ['pine', 'rock', 'crystal'], sceneryA: '#1d3550', sceneryB: '#8fb6d8',
    ambient: 'snow', ambientColor: '#ffffff', stars: true
  },
  {
    id: 'skyreach',
    name: 'Skyreach Pass',
    flavor: 'Thin air. Prayer flags for the ones who did not make it.',
    skyTop: '#0a1a3c', skyBottom: '#7fb0e0',
    sun: '#fff8e8', sunGlow: 'rgba(255,240,220,0.4)',
    hillFar: '#5a7a9c', hillNear: '#3a5878',
    fog: 'rgba(200,225,250,0.55)',
    roadA: '#55586a', roadB: '#4b4e5e', roadEdge: '#d8e8f8', stripe: '#ffffff',
    ground: '#8a9ab0', groundB: '#6f8098',
    tint: 'rgba(200,230,255,0.16)',
    scenery: ['peak', 'banner', 'icespike', 'rock'], sceneryA: '#3a4a60', sceneryB: '#eef6ff',
    ambient: 'wind', ambientColor: '#ffffff', stars: true
  },
  {
    id: 'stormcoast',
    name: 'The Stormcoast',
    flavor: 'Rain sideways. The sea keeps what it wrecks.',
    skyTop: '#0a1220', skyBottom: '#3a5068',
    sun: '#c8d8e8', sunGlow: 'rgba(160,190,220,0.25)',
    hillFar: '#243a4c', hillNear: '#182838',
    fog: 'rgba(120,150,180,0.6)',
    roadA: '#3a4048', roadB: '#333940', roadEdge: '#7f98b0', stripe: '#d0e0f0',
    ground: '#26333a', groundB: '#1e2a30',
    tint: 'rgba(90,140,190,0.22)',
    scenery: ['palm', 'wreck', 'rock'], sceneryA: '#1a2a30', sceneryB: '#3f7a5a',
    ambient: 'rain', ambientColor: '#bcd4ea', stars: false, lightning: true
  },
  {
    id: 'duskvale',
    name: 'Duskvale',
    flavor: 'Spores glow where the light gave up.',
    skyTop: '#150b2e', skyBottom: '#5b3a8a',
    sun: '#c9a6ff', sunGlow: 'rgba(180,130,255,0.35)',
    hillFar: '#38246b', hillNear: '#241546',
    fog: 'rgba(150,110,220,0.5)',
    roadA: '#3a3350', roadB: '#332d47', roadEdge: '#b79bff', stripe: '#efe6ff',
    ground: '#241a3d', groundB: '#2e2350',
    tint: 'rgba(180,120,255,0.18)',
    scenery: ['mushroom', 'ruin', 'crystal'], sceneryA: '#1b1233', sceneryB: '#7a5ad0',
    ambient: 'spore', ambientColor: '#c9a6ff', stars: true
  },
  {
    id: 'gloomfen',
    name: 'Gloomfen',
    flavor: 'The lights in the bog are not lanterns. Do not follow them.',
    skyTop: '#070c12', skyBottom: '#243a3a',
    sun: '#9fe8d0', sunGlow: 'rgba(120,220,190,0.25)',
    hillFar: '#16282a', hillNear: '#0f1c1e',
    fog: 'rgba(90,140,130,0.6)',
    roadA: '#2c3230', roadB: '#262b2a', roadEdge: '#6f9a8a', stripe: '#b8d8c8',
    ground: '#121c18', groundB: '#18241f',
    tint: 'rgba(80,200,170,0.16)',
    scenery: ['deadtree', 'totem', 'reed'], sceneryA: '#0d1614', sceneryB: '#7fe8c8',
    ambient: 'wisp', ambientColor: '#8ff0d8', stars: true
  },
  {
    id: 'ashfall',
    name: 'Ashfall Waste',
    flavor: 'Everything here burned once. Some of it still is.',
    skyTop: '#2a0f16', skyBottom: '#b9522e',
    sun: '#ffd06a', sunGlow: 'rgba(255,120,60,0.4)',
    hillFar: '#5d2a25', hillNear: '#3a1a1a',
    fog: 'rgba(199,110,66,0.5)',
    roadA: '#443634', roadB: '#3b2f2e', roadEdge: '#e0a070', stripe: '#ffd9b0',
    ground: '#3a2320', groundB: '#4a2c26',
    tint: 'rgba(255,120,60,0.18)',
    scenery: ['bone', 'rock', 'ruin'], sceneryA: '#2a1715', sceneryB: '#6a4038',
    ambient: 'ember', ambientColor: '#ff9d4d', stars: false
  },
  {
    id: 'emberdeep',
    name: 'Emberdeep',
    flavor: 'The ground breathes. Keep to the middle of the road.',
    skyTop: '#140608', skyBottom: '#7a2a14',
    sun: '#ffb050', sunGlow: 'rgba(255,90,30,0.5)',
    hillFar: '#3a1410', hillNear: '#24100c',
    fog: 'rgba(200,80,30,0.45)',
    roadA: '#3a2a28', roadB: '#302220', roadEdge: '#ff8a40', stripe: '#ffc890',
    ground: '#1e0c0a', groundB: '#2c1210',
    tint: 'rgba(255,110,40,0.26)',
    scenery: ['lavarock', 'geyser', 'rock'], sceneryA: '#1a0c0a', sceneryB: '#ff7a2f',
    ambient: 'ash', ambientColor: '#c8b0a0', stars: false
  },
  {
    id: 'voidreach',
    name: 'The Voidreach',
    flavor: 'The road continues. Nothing else does.',
    skyTop: '#03040c', skyBottom: '#1b1140',
    sun: '#7fe6ff', sunGlow: 'rgba(80,200,255,0.3)',
    hillFar: '#151038', hillNear: '#0b0824',
    fog: 'rgba(90,80,190,0.45)',
    roadA: '#232042', roadB: '#1c1936', roadEdge: '#6fe0ff', stripe: '#a8f0ff',
    ground: '#0a0820', groundB: '#120e2e',
    tint: 'rgba(100,220,255,0.2)',
    scenery: ['crystal', 'ruin', 'rock'], sceneryA: '#0d0a26', sceneryB: '#4de0ff',
    ambient: 'spore', ambientColor: '#7fe6ff', stars: true
  }
];

export function biomeFor(worldCycle: number): Biome {
  return BIOMES[worldCycle % BIOMES.length];
}

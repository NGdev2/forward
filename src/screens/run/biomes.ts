/* ============================================================================
 * Biome palettes. The world cycle picks one, so beating a boss visibly moves
 * the run into new country.
 * ========================================================================== */

export type SceneryKind = 'tree' | 'pine' | 'rock' | 'cactus' | 'crystal' | 'ruin' | 'bone' | 'mushroom';
export type AmbientKind = 'none' | 'leaf' | 'snow' | 'ember' | 'dust' | 'spore';

export interface Biome {
  id: string;
  name: string;
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
  scenery: SceneryKind[];
  sceneryA: string;
  sceneryB: string;
  ambient: AmbientKind;
  ambientColor: string;
  stars: boolean;
}

export const BIOMES: Biome[] = [
  {
    id: 'greenway',
    name: 'The Greenway',
    skyTop: '#0d1b3a', skyBottom: '#4a6ea8',
    sun: '#ffd9a0', sunGlow: 'rgba(255,196,120,0.35)',
    hillFar: '#26406b', hillNear: '#1b2c4d',
    fog: 'rgba(112,152,206,0.55)',
    roadA: '#3a3f52', roadB: '#333849', roadEdge: '#8fa3c9', stripe: '#e9edf8',
    ground: '#1f3a2c', groundB: '#274634',
    scenery: ['tree', 'pine', 'rock'], sceneryA: '#173427', sceneryB: '#2c5a3d',
    ambient: 'leaf', ambientColor: '#7fc98a', stars: false
  },
  {
    id: 'ashfall',
    name: 'Ashfall Waste',
    skyTop: '#2a0f16', skyBottom: '#b9522e',
    sun: '#ffd06a', sunGlow: 'rgba(255,120,60,0.4)',
    hillFar: '#5d2a25', hillNear: '#3a1a1a',
    fog: 'rgba(199,110,66,0.5)',
    roadA: '#443634', roadB: '#3b2f2e', roadEdge: '#e0a070', stripe: '#ffd9b0',
    ground: '#3a2320', groundB: '#4a2c26',
    scenery: ['bone', 'rock', 'ruin'], sceneryA: '#2a1715', sceneryB: '#6a4038',
    ambient: 'ember', ambientColor: '#ff9d4d', stars: false
  },
  {
    id: 'frostmarch',
    name: 'The Frostmarch',
    skyTop: '#071429', skyBottom: '#5f86b8',
    sun: '#e8f4ff', sunGlow: 'rgba(190,225,255,0.35)',
    hillFar: '#2b4a72', hillNear: '#1b3050',
    fog: 'rgba(190,220,255,0.5)',
    roadA: '#4a5468', roadB: '#414b5e', roadEdge: '#cfe4ff', stripe: '#ffffff',
    ground: '#c8d8ea', groundB: '#b0c4dc',
    scenery: ['pine', 'rock', 'crystal'], sceneryA: '#1d3550', sceneryB: '#8fb6d8',
    ambient: 'snow', ambientColor: '#ffffff', stars: true
  },
  {
    id: 'duskvale',
    name: 'Duskvale',
    skyTop: '#150b2e', skyBottom: '#5b3a8a',
    sun: '#c9a6ff', sunGlow: 'rgba(180,130,255,0.35)',
    hillFar: '#38246b', hillNear: '#241546',
    fog: 'rgba(150,110,220,0.5)',
    roadA: '#3a3350', roadB: '#332d47', roadEdge: '#b79bff', stripe: '#efe6ff',
    ground: '#241a3d', groundB: '#2e2350',
    scenery: ['mushroom', 'ruin', 'crystal'], sceneryA: '#1b1233', sceneryB: '#7a5ad0',
    ambient: 'spore', ambientColor: '#c9a6ff', stars: true
  },
  {
    id: 'sunsands',
    name: 'The Sunsands',
    skyTop: '#1a3358', skyBottom: '#e2b56a',
    sun: '#fff2c0', sunGlow: 'rgba(255,220,140,0.45)',
    hillFar: '#a8814c', hillNear: '#7c5c34',
    fog: 'rgba(226,190,130,0.55)',
    roadA: '#5a4a38', roadB: '#4f4131', roadEdge: '#ffe0a0', stripe: '#fff4d6',
    ground: '#c9a566', groundB: '#b8934f',
    scenery: ['cactus', 'rock', 'bone'], sceneryA: '#6b4f2c', sceneryB: '#3f7a4a',
    ambient: 'dust', ambientColor: '#e8cf9a', stars: false
  },
  {
    id: 'voidreach',
    name: 'The Voidreach',
    skyTop: '#03040c', skyBottom: '#1b1140',
    sun: '#7fe6ff', sunGlow: 'rgba(80,200,255,0.3)',
    hillFar: '#151038', hillNear: '#0b0824',
    fog: 'rgba(90,80,190,0.45)',
    roadA: '#232042', roadB: '#1c1936', roadEdge: '#6fe0ff', stripe: '#a8f0ff',
    ground: '#0a0820', groundB: '#120e2e',
    scenery: ['crystal', 'ruin', 'rock'], sceneryA: '#0d0a26', sceneryB: '#4de0ff',
    ambient: 'spore', ambientColor: '#7fe6ff', stars: true
  }
];

export function biomeFor(worldCycle: number): Biome {
  return BIOMES[worldCycle % BIOMES.length];
}

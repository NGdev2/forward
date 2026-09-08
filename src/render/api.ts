/* ============================================================================
 * Rendering contracts consumed by every screen.
 * Implementations live in sprites.ts / fx.ts / audio.ts.
 * Members may be ADDED here, but existing signatures must stay stable —
 * the run, combat, inventory and reward screens all code against them.
 * ========================================================================== */

import type { EquipmentSet, Rarity } from '../game/types';

export type HeroPose = 'run' | 'idle' | 'attack' | 'cast' | 'hurt' | 'victory' | 'defend';

/** Visual description of the player, derived from equipped gear. */
export interface HeroLook {
  weaponId: string | null;
  weaponRarity: Rarity | null;
  offhandId: string | null;
  offhandRarity: Rarity | null;
  helmId: string | null;
  helmRarity: Rarity | null;
  armorId: string | null;
  armorRarity: Rarity | null;
  bootsId: string | null;
  bootsRarity: Rarity | null;
  trinketId: string | null;
  trinketRarity: Rarity | null;
}

export function lookFromEquipment(eq: EquipmentSet): HeroLook {
  return {
    weaponId: eq.weapon?.baseId ?? null,
    weaponRarity: eq.weapon?.rarity ?? null,
    offhandId: eq.offhand?.baseId ?? null,
    offhandRarity: eq.offhand?.rarity ?? null,
    helmId: eq.helm?.baseId ?? null,
    helmRarity: eq.helm?.rarity ?? null,
    armorId: eq.armor?.baseId ?? null,
    armorRarity: eq.armor?.rarity ?? null,
    bootsId: eq.boots?.baseId ?? null,
    bootsRarity: eq.boots?.rarity ?? null,
    trinketId: eq.trinket?.baseId ?? null,
    trinketRarity: eq.trinket?.rarity ?? null
  };
}

export type CreaturePose = 'idle' | 'attack' | 'hurt' | 'dead' | 'charge';

export interface DrawOpts {
  /** Seconds since the scene started; drives idle/run cycles. */
  time: number;
  /** 1 = facing right, -1 = facing left. */
  facing?: 1 | -1;
  /** 0..1 white flash applied on hit. */
  flash?: number;
  /** 0..1 fade for death/spawn. */
  alpha?: number;
}

export interface SpriteKit {
  /**
   * Draws the player centred horizontally on `x`, standing on the ground
   * line `y`. `scale` 1 renders roughly 100px tall.
   */
  drawHero(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    look: HeroLook,
    pose: HeroPose,
    opts: DrawOpts
  ): void;

  /**
   * Draws an enemy by its data id (e.g. "e_goblin", "b_lich"), centred on `x`
   * and standing on `y`. Unknown ids fall back to a design derived from the id
   * so new content always renders something coherent.
   */
  drawCreature(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    scale: number,
    enemyId: string,
    pose: CreaturePose,
    opts: DrawOpts
  ): void;

  /** Renders a creature to an offscreen canvas, for use as a DOM portrait. */
  creaturePortrait(enemyId: string, size: number): HTMLCanvasElement;

  /** Renders the hero to an offscreen canvas, for menus and the inventory doll. */
  heroPortrait(look: HeroLook, size: number, pose?: HeroPose): HTMLCanvasElement;
}

export type BurstKind = 'hit' | 'crit' | 'heal' | 'coin' | 'magic' | 'dust' | 'death' | 'levelup';

export interface BurstOpts {
  count?: number;
  color?: string;
  spread?: number;
  speed?: number;
  gravity?: number;
}

export type FloatKind =
  | 'damage'
  | 'crit'
  | 'heal'
  | 'block'
  | 'miss'
  | 'gold'
  | 'xp'
  | 'status'
  | 'parry'
  | 'shield'
  | 'hint';

/**
 * Visual flavour of an attack trail / parry impact. Set elements come from
 * `data/items.ts` (`SetElement`); the rest map ability schools. `steel` is the
 * clean default when nothing elemental is worn.
 */
export type FxElement =
  | 'steel'
  | 'fire'
  | 'water'
  | 'void'
  | 'holy'
  | 'metal'
  | 'beast'
  | 'frost'
  | 'arcane'
  | 'poison';

export interface FxKit {
  /** Advances particles. Called once per frame by the active screen. */
  update(dt: number): void;
  /** Draws live particles into a canvas context. */
  draw(c: CanvasRenderingContext2D): void;
  /** Spawns a particle burst in canvas coordinates. */
  burst(x: number, y: number, kind: BurstKind, opts?: BurstOpts): void;
  /** Shakes a DOM element (the screen root, or a single combatant). */
  shake(el: HTMLElement, intensity?: number, ms?: number): void;
  /**
   * Spawns a floating number/label. `x`/`y` are relative to `host`, which must
   * be positioned. The element removes itself when the animation ends.
   */
  float(host: HTMLElement, x: number, y: number, text: string, kind?: FloatKind): void;
  /** Full-screen colour flash, e.g. red on taking a heavy hit. */
  flash(color: string, ms?: number): void;
  /** Clears all live particles, e.g. on screen change. */
  clear(): void;
  /** Elemental streak from (x0,y0) to (x1,y1) — the path of a strike or bolt. */
  trail(x0: number, y0: number, x1: number, y1: number, element: FxElement): void;
  /** Elemental impact at a point — fire ring, water arc, claw slashes… */
  impact(x: number, y: number, element: FxElement, opts?: { scale?: number }): void;
}

export type SfxId =
  | 'ui_tap'
  | 'ui_back'
  | 'hit'
  | 'crit'
  | 'block'
  | 'hurt'
  | 'heal'
  | 'coin'
  | 'loot'
  | 'legendary'
  | 'levelup'
  | 'boss'
  | 'victory'
  | 'defeat'
  | 'swoosh'
  | 'magic';

export interface AudioKit {
  play(id: SfxId): void;
  setEnabled(on: boolean): void;
  get enabled(): boolean;
  /** Mixer level 0..1 for all effects. */
  setVolume(v: number): void;
  /** Browsers require a user gesture before audio can start. */
  unlock(): void;
}

/* ----------------------------------------------------------------- music -- */

/**
 * Which score is playing. Screens set the mode on mount; the music layer
 * crossfades between them and never restarts a track that is already playing.
 */
export type MusicMode = 'off' | 'title' | 'run' | 'combat' | 'boss' | 'shop' | 'victory' | 'defeat';

export interface MusicKit {
  setMode(mode: MusicMode): void;
  get mode(): MusicMode;
  /**
   * 0..1 tension knob: the combat score layers in percussion and a rising
   * motif as the player's HP falls or a boss enters a new phase.
   */
  setIntensity(v: number): void;
  /** Mixer level 0..1. */
  setVolume(v: number): void;
  setEnabled(on: boolean): void;
  get enabled(): boolean;
  /** Called on the first user gesture so the AudioContext can start. */
  unlock(): void;
}

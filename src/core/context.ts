import type { GameState } from '../game/state';
import type { AudioKit, FxKit, MusicKit, SpriteKit } from '../render/api';
import type { AdService } from '../platform/ads';
import type { CombatResult, EncounterNode, EnemyInstance, ItemInstance, Rarity } from '../game/types';

export type ScreenId = 'title' | 'run' | 'combat' | 'reward' | 'inventory' | 'shop';

export interface ScreenParams {
  [key: string]: unknown;
}

/** Params handed to the combat screen. */
export interface CombatParams extends ScreenParams {
  enemy: EnemyInstance;
  node?: EncounterNode;
}

/** Params handed to the inventory screen. */
export interface InventoryParams extends ScreenParams {
  /** Where "back" returns to. Defaults to the road. */
  from?: ScreenId;
  /** Open on a specific tab. */
  tab?: 'bag' | 'stats' | 'sets' | 'items';
}

/** Params handed to the shop screen. */
export interface ShopParams extends ScreenParams {
  /** Open on a specific tab, e.g. 'sell' when returning from the bag. */
  tab?: string;
}

/**
 * Params handed to the reward screen.
 *
 * The reward screen is the SINGLE place that applies rewards to state — gold,
 * xp, healing, loot and boss-bar progress. Callers describe what was earned;
 * they must not mutate state themselves.
 */
export interface RewardParams extends ScreenParams {
  title: string;
  icon: string;
  message?: string;
  /** Base gold before goldFind is applied. */
  gold?: number;
  xp?: number;
  /** Flat HP to restore. */
  heal?: number;
  /** How many items to roll as loot. */
  lootCount?: number;
  /** Forces the rarity of rolled loot, e.g. a boss's guaranteed drop. */
  lootRarity?: Rarity;
  /** Pre-rolled loot, when the caller already generated it. */
  loot?: ItemInstance[];
  /** Advance the boss bar by one step. Defaults to true. */
  grantProgress?: boolean;
  /** Completes the world cycle and rerolls the boss bar. */
  bossDefeated?: boolean;
  /** Set when the reward followed a fight. */
  combat?: CombatResult;
  /** The node that produced this reward, for flavour. */
  node?: EncounterNode;
  /** Offer a (placeholder) rewarded-ad double-up on this reward. */
  allowDouble?: boolean;
}

export type ToastKind = 'info' | 'good' | 'bad' | 'legendary';

export interface Screen {
  readonly id: ScreenId;
  /** Build DOM into `root`. Called once per navigation. */
  mount(root: HTMLElement, ctx: GameContext, params: ScreenParams): void;
  /** Called every frame while active. `dt` is seconds since the last frame. */
  update?(dt: number): void;
  /** Release listeners, observers and any retained DOM. */
  unmount(): void;
}

export interface GameContext {
  state: GameState;
  sprites: SpriteKit;
  fx: FxKit;
  audio: AudioKit;
  music: MusicKit;
  /** Rewarded ads (mock in dev, AdMob on Android, none on the web build). */
  ads: AdService;
  goto(id: ScreenId, params?: ScreenParams): void;
  toast(message: string, kind?: ToastKind): void;
  /** Persists state; call after anything meaningful changes. */
  save(): void;
}

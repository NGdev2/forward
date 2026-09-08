import './styles/index.css';
import { GameState } from './game/state';
import { ScreenManager } from './core/screens';
import type { GameContext, ScreenId, ScreenParams, ToastKind } from './core/context';
import { Sprites } from './render/sprites';
import { Fx } from './render/fx';
import { Audio } from './render/audio';
import { Music } from './render/music';
import { RunScreen } from './screens/RunScreen';
import { CombatScreen } from './screens/CombatScreen';
import { RewardScreen } from './screens/RewardScreen';
import { InventoryScreen } from './screens/InventoryScreen';
import { ShopScreen } from './screens/ShopScreen';
import { TitleScreen } from './screens/TitleScreen';
import { setLanguage } from './i18n';

const root = document.getElementById('game-root');
if (!root) throw new Error('#game-root missing');

const state = new GameState();
// Localisation must be live before the first screen mounts.
setLanguage(state.stats.settings.language);
const sprites = new Sprites();
const fx = new Fx();
const audio = new Audio();
audio.setEnabled(state.stats.settings.sfx);
audio.setVolume(state.stats.settings.sfxVolume);
const music = new Music();
music.setEnabled(state.stats.settings.music);
music.setVolume(state.stats.settings.musicVolume);

const manager = new ScreenManager(root);

const toastHost = document.createElement('div');
toastHost.className = 'toast-host';
root.appendChild(toastHost);

const ctx: GameContext = {
  state,
  sprites,
  fx,
  audio,
  music,
  goto(id: ScreenId, params: ScreenParams = {}) {
    fx.clear();
    void manager.goto(id, params);
  },
  toast(message: string, kind: ToastKind = 'info') {
    const node = document.createElement('div');
    node.className = `toast toast-${kind}`;
    node.textContent = message;
    toastHost.appendChild(node);
    window.setTimeout(() => {
      node.classList.add('is-out');
      window.setTimeout(() => node.remove(), 300);
    }, 2100);
  },
  save() {
    state.save();
  }
};

manager.attachContext(ctx);
manager.register(new TitleScreen());
manager.register(new RunScreen());
manager.register(new CombatScreen());
manager.register(new RewardScreen());
manager.register(new InventoryScreen());
manager.register(new ShopScreen());
manager.start();

// Any first touch unlocks WebAudio on mobile browsers.
const unlock = () => {
  audio.unlock();
  music.unlock();
};
window.addEventListener('pointerdown', unlock, { once: true });

// Always open on the front door; Continue is one tap away.
void manager.goto('title');

// Dev-only handle so the QA harness can jump straight to a screen.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = ctx;
}

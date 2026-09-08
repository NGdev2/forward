import type { AudioKit, SfxId } from './api';

interface Tone {
  type: OscillatorType;
  freq: number;
  to?: number;
  dur: number;
  gain: number;
  delay?: number;
  noise?: boolean;
}

/** Every sound is synthesised at runtime — no audio assets to ship. */
const SFX: Record<SfxId, Tone[]> = {
  ui_tap: [{ type: 'sine', freq: 660, to: 880, dur: 0.07, gain: 0.1 }],
  ui_back: [{ type: 'sine', freq: 520, to: 340, dur: 0.09, gain: 0.1 }],
  hit: [
    { type: 'square', freq: 180, to: 90, dur: 0.09, gain: 0.14 },
    { type: 'sine', freq: 420, to: 160, dur: 0.07, gain: 0.08, noise: true }
  ],
  crit: [
    { type: 'sawtooth', freq: 300, to: 120, dur: 0.16, gain: 0.18 },
    { type: 'square', freq: 900, to: 400, dur: 0.12, gain: 0.1, delay: 0.02 }
  ],
  block: [{ type: 'triangle', freq: 240, to: 180, dur: 0.12, gain: 0.13 }],
  hurt: [{ type: 'sawtooth', freq: 220, to: 70, dur: 0.2, gain: 0.15 }],
  heal: [
    { type: 'sine', freq: 520, to: 780, dur: 0.18, gain: 0.11 },
    { type: 'sine', freq: 780, to: 1040, dur: 0.16, gain: 0.08, delay: 0.08 }
  ],
  coin: [
    { type: 'square', freq: 980, dur: 0.06, gain: 0.09 },
    { type: 'square', freq: 1320, dur: 0.09, gain: 0.08, delay: 0.05 }
  ],
  loot: [
    { type: 'triangle', freq: 640, to: 900, dur: 0.14, gain: 0.1 },
    { type: 'triangle', freq: 900, to: 1200, dur: 0.16, gain: 0.09, delay: 0.09 }
  ],
  legendary: [
    { type: 'sawtooth', freq: 320, to: 640, dur: 0.3, gain: 0.12 },
    { type: 'sine', freq: 880, to: 1320, dur: 0.4, gain: 0.11, delay: 0.12 },
    { type: 'sine', freq: 1320, to: 1760, dur: 0.4, gain: 0.09, delay: 0.26 }
  ],
  levelup: [
    { type: 'square', freq: 523, dur: 0.1, gain: 0.1 },
    { type: 'square', freq: 659, dur: 0.1, gain: 0.1, delay: 0.09 },
    { type: 'square', freq: 784, dur: 0.16, gain: 0.11, delay: 0.18 },
    { type: 'square', freq: 1047, dur: 0.24, gain: 0.1, delay: 0.28 }
  ],
  boss: [
    { type: 'sawtooth', freq: 90, to: 55, dur: 0.7, gain: 0.2 },
    { type: 'square', freq: 140, to: 70, dur: 0.5, gain: 0.1, delay: 0.1 }
  ],
  victory: [
    { type: 'triangle', freq: 659, dur: 0.12, gain: 0.11 },
    { type: 'triangle', freq: 784, dur: 0.12, gain: 0.11, delay: 0.11 },
    { type: 'triangle', freq: 1047, dur: 0.3, gain: 0.12, delay: 0.22 }
  ],
  defeat: [
    { type: 'sawtooth', freq: 300, to: 90, dur: 0.5, gain: 0.16 },
    { type: 'sine', freq: 200, to: 60, dur: 0.6, gain: 0.12, delay: 0.12 }
  ],
  swoosh: [{ type: 'sine', freq: 900, to: 260, dur: 0.11, gain: 0.07, noise: true }],
  magic: [
    { type: 'sine', freq: 700, to: 1300, dur: 0.2, gain: 0.1 },
    { type: 'triangle', freq: 1300, to: 700, dur: 0.2, gain: 0.07, delay: 0.08 }
  ]
};

export class Audio implements AudioKit {
  private ctx: AudioContext | null = null;
  private on = true;
  private volume = 0.8;
  private noiseBuffer: AudioBuffer | null = null;

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
  }

  get enabled() {
    return this.on;
  }

  setEnabled(on: boolean) {
    this.on = on;
  }

  unlock() {
    if (!this.on) return;
    const ctx = this.ensureCtx();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private getNoise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  play(id: SfxId) {
    if (!this.on) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const tones = SFX[id];
    if (!tones) return;
    const now = ctx.currentTime;

    for (const tone of tones) {
      const start = now + (tone.delay ?? 0);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, tone.gain * this.volume), start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.dur);
      gain.connect(ctx.destination);

      if (tone.noise) {
        const src = ctx.createBufferSource();
        src.buffer = this.getNoise(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(tone.freq, start);
        if (tone.to) filter.frequency.exponentialRampToValueAtTime(Math.max(40, tone.to), start + tone.dur);
        src.connect(filter);
        filter.connect(gain);
        src.start(start);
        src.stop(start + tone.dur + 0.02);
      } else {
        const osc = ctx.createOscillator();
        osc.type = tone.type;
        osc.frequency.setValueAtTime(tone.freq, start);
        if (tone.to) osc.frequency.exponentialRampToValueAtTime(Math.max(30, tone.to), start + tone.dur);
        osc.connect(gain);
        osc.start(start);
        osc.stop(start + tone.dur + 0.02);
      }
    }
  }
}

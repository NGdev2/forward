import type { MusicKit, MusicMode } from './api';

/* ============================================================================
 * FORWARD — dynamic music. A WebAudio step sequencer, no assets.
 *
 * Architecture
 *   • One AudioContext, created lazily on unlock() (first user gesture).
 *   • A look-ahead scheduler (setInterval 25 ms, schedules 100 ms ahead) walks
 *     16th-note steps for every live "layer". A layer = one mode's composition
 *     playing through its own gain node, so crossfades are just gain ramps.
 *   • Every mode is a small composition in A minor / C major so that a
 *     crossfade between any two of them sounds like a modulation, not a clash.
 *   • setIntensity(0..1) is read at schedule time: the combat/boss scores add
 *     hats, a second bass octave and a high tension motif as it rises.
 *
 * Synthesis is oscillators + envelopes + a lowpass. Kick = sine pitch drop,
 * snare = bandpassed noise burst + short sine, hat = highpassed noise.
 * Every voice stops itself after its envelope so the node count stays flat.
 * ========================================================================== */

const LOOKAHEAD_S = 0.1;
const TICK_MS = 25;
const XFADE_S = 0.8;

/** Frequency of a note `semis` semitones above A2 (110 Hz). */
const A2 = 110;
const n = (semis: number) => A2 * Math.pow(2, semis / 12);

/* Scale degrees (semitones from A): A B C D E F G */
const A = 0, B = 2, C = 3, D = 5, E = 7, F = 8, G = 10;

/** Chord voicings as semitone offsets from A2. */
const CH = {
  Am: [A, C, E],
  F: [F - 12, A, C],
  C: [C, E, G],
  G: [G - 12, B, D],
  Dm: [D, F, A + 12],
  Em: [E - 12, G, B],
  E: [E - 12, G + 1, B],
  Bdim: [B - 12, D, F]
} as const;
type ChordName = keyof typeof CH;

interface Voice {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  /** Lowpass cutoff. */
  cutoff?: number;
  detune?: number;
  /** Slide from `freq` to `to` over the note. */
  to?: number;
}

interface Layer {
  mode: MusicMode;
  bus: GainNode;
  step: number;
  nextTime: number;
  secPerStep: number;
  /** When set, the layer is fading out and will be dropped after this time. */
  endAt: number | null;
  comp: Composition;
  /** Echo/effect nodes owned by this layer, disconnected with it. */
  nodes: AudioNode[];
}

interface Composition {
  bpm: number;
  /** Loop length in bars of 16 steps. */
  bars: number;
  /** Stop scheduling after this many bars (one-shot stingers). */
  stopAfterBars?: number;
  /** Feedback delay send level for the whole bus, 0 = none. */
  echo?: number;
  /** Schedule everything that sounds on this step into `b`. `abs` never wraps. */
  play(m: Music, b: GainNode, t: number, step: number, abs: number, bar: number): void;
}

export class Music implements MusicKit {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private layers: Layer[] = [];
  private timer = 0;
  private current: MusicMode = 'off';
  private on = true;
  private volume = 0.6;
  private intensity = 0;
  private unlocked = false;

  /* -------------------------------------------------------------- public -- */

  get mode() {
    return this.current;
  }
  get enabled() {
    return this.on;
  }

  setMode(mode: MusicMode) {
    if (mode === this.current) return;
    this.current = mode;
    if (!this.ac || !this.on) return;
    this.startLayer(mode);
  }

  setIntensity(v: number) {
    this.intensity = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    if (this.master && this.ac) {
      this.master.gain.cancelScheduledValues(this.ac.currentTime);
      this.master.gain.setTargetAtTime(this.volume * this.volume, this.ac.currentTime, 0.05);
    }
  }

  setEnabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (!on) {
      // Fade everything out and stop the scheduler — costs nothing while off.
      for (const l of this.layers) this.fadeOut(l);
      if (this.master && this.ac) this.master.gain.setTargetAtTime(0, this.ac.currentTime, 0.1);
      window.setTimeout(() => {
        if (!this.on) this.stopAll();
      }, 500);
    } else {
      if (this.unlocked) this.ensureContext();
      if (this.ac && this.ac.state === 'suspended') void this.ac.resume().catch(() => {});
      if (this.master && this.ac) this.master.gain.setTargetAtTime(this.volume * this.volume, this.ac.currentTime, 0.1);
      if (this.ac && this.current !== 'off') this.startLayer(this.current);
    }
  }

  unlock() {
    this.unlocked = true;
    if (!this.on) return;
    const ac = this.ensureContext();
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume().catch(() => {});
    if (this.current !== 'off' && !this.layers.some(l => l.mode === this.current && !l.endAt)) {
      this.startLayer(this.current);
    }
  }

  /* --------------------------------------------------------------- setup -- */

  private ensureContext(): AudioContext | null {
    if (this.ac) return this.ac;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ac = new Ctor();
      const master = ac.createGain();
      master.gain.value = this.volume * this.volume;
      // Soften the synths and glue the mix: lowpass → compressor → out.
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 9000;
      lp.Q.value = 0.4;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.01;
      comp.release.value = 0.2;
      master.connect(lp);
      lp.connect(comp);
      comp.connect(ac.destination);
      this.ac = ac;
      this.master = master;
      // A backgrounded app should go quiet; come back in time when it returns.
      document.addEventListener('visibilitychange', () => {
        if (!this.ac) return;
        if (document.hidden) void this.ac.suspend().catch(() => {});
        else if (this.on) void this.ac.resume().catch(() => {});
      });
      return ac;
    } catch {
      return null;
    }
  }

  private getNoise(ac: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const len = Math.floor(ac.sampleRate * 1.0);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return buf;
  }

  /* -------------------------------------------------------------- layers -- */

  private startLayer(mode: MusicMode) {
    const ac = this.ac;
    if (!ac || !this.master) return;
    const now = ac.currentTime;
    for (const l of this.layers) if (!l.endAt) this.fadeOut(l);
    if (mode === 'off') return;
    const comp = COMPOSITIONS[mode];
    if (!comp) return;

    const bus = ac.createGain();
    const nodes: AudioNode[] = [];
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(1, now + XFADE_S);
    bus.connect(this.master);
    if (comp.echo) {
      try {
        const delay = ac.createDelay(1.0);
        delay.delayTime.value = (60 / comp.bpm) * 0.75; // dotted-eighth echo
        const fb = ac.createGain();
        fb.gain.value = 0.32;
        const send = ac.createGain();
        send.gain.value = comp.echo;
        const tone = ac.createBiquadFilter();
        tone.type = 'lowpass';
        tone.frequency.value = 2600;
        bus.connect(send);
        send.connect(delay);
        delay.connect(tone);
        tone.connect(fb);
        fb.connect(delay);
        tone.connect(this.master);
        nodes.push(send, delay, tone, fb);
      } catch {
        /* echo is decoration */
      }
    }

    this.layers.push({
      mode,
      bus,
      step: 0,
      nextTime: now + 0.05,
      secPerStep: 60 / comp.bpm / 4,
      endAt: null,
      comp,
      nodes
    });
    this.startTimer();
  }

  private fadeOut(l: Layer) {
    if (!this.ac || l.endAt) return;
    const now = this.ac.currentTime;
    l.bus.gain.cancelScheduledValues(now);
    l.bus.gain.setValueAtTime(l.bus.gain.value, now);
    l.bus.gain.linearRampToValueAtTime(0.0001, now + XFADE_S);
    l.endAt = now + XFADE_S + 0.05;
  }

  private dropLayer(l: Layer) {
    try {
      l.bus.disconnect();
      for (const node of l.nodes) node.disconnect();
    } catch {
      /* already gone */
    }
  }

  private stopAll() {
    for (const l of this.layers) this.dropLayer(l);
    this.layers = [];
    this.stopTimer();
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer() {
    if (!this.timer) return;
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  /* ----------------------------------------------------------- scheduler -- */

  private tick() {
    const ac = this.ac;
    if (!ac) return this.stopTimer();
    const now = ac.currentTime;

    // Drop finished fades.
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      // Give the echo tail a couple of seconds before tearing the nodes down.
      if (l.endAt !== null && l.endAt + 2.5 < now) {
        this.dropLayer(l);
        this.layers.splice(i, 1);
      }
    }
    if (!this.layers.length) return this.stopTimer();
    if (ac.state !== 'running') return;

    for (const l of this.layers) {
      const stopAt = l.comp.stopAfterBars ? l.comp.stopAfterBars * 16 : Infinity;
      // Background tabs throttle timers: rather than machine-gun the missed
      // steps, jump the clock forward and carry on in time.
      if (l.nextTime < now - 0.25) l.nextTime = now + 0.02;
      while (l.nextTime < now + LOOKAHEAD_S) {
        if (l.step < stopAt && l.endAt === null) {
          const loopStep = l.step % (l.comp.bars * 16);
          try {
            l.comp.play(this, l.bus, l.nextTime, loopStep, l.step, Math.floor(loopStep / 16));
          } catch {
            /* a bad note must never kill the scheduler */
          }
        }
        l.nextTime += l.secPerStep;
        l.step++;
      }
    }
  }

  /* --------------------------------------------------------------- voices --
   * Every helper takes the destination bus explicitly so compositions can be
   * written as pure functions of (time, step). */

  private dest(bus?: GainNode): AudioNode | null {
    return bus ?? this.master;
  }

  tone(bus: GainNode, freq: number, t: number, dur: number, v: Voice = {}) {
    const ac = this.ac;
    const out = this.dest(bus);
    if (!ac || !out) return;
    const attack = v.attack ?? 0.01;
    const release = v.release ?? Math.min(0.25, dur * 0.6);
    const peak = Math.max(0.0002, v.gain ?? 0.1);
    const osc = ac.createOscillator();
    osc.type = v.type ?? 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    if (v.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, v.to), t + dur);
    if (v.detune) osc.detune.value = v.detune;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, Math.max(t + attack, t + dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.01);
    let head: AudioNode = osc;
    if (v.cutoff) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(v.cutoff, t);
      f.Q.value = 0.8;
      osc.connect(f);
      head = f;
    }
    head.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Two slightly detuned oscillators through a lowpass — a soft synth pad. */
  pad(bus: GainNode, freqs: readonly number[], t: number, dur: number, gain = 0.05, cutoff = 700) {
    for (const f of freqs) {
      this.tone(bus, f, t, dur, { type: 'sawtooth', gain, attack: dur * 0.35, release: dur * 0.4, cutoff, detune: -6 });
      this.tone(bus, f, t, dur, { type: 'sawtooth', gain, attack: dur * 0.35, release: dur * 0.4, cutoff, detune: 7 });
    }
  }

  /** Short bright pluck (arps, lute). */
  pluck(bus: GainNode, freq: number, t: number, gain = 0.09, dur = 0.28) {
    this.tone(bus, freq, t, dur, { type: 'triangle', gain, attack: 0.004, release: dur * 0.85, cutoff: 3200 });
    this.tone(bus, freq * 2, t, dur * 0.4, { type: 'sine', gain: gain * 0.35, attack: 0.002, release: dur * 0.3 });
  }

  /** Saw bass with a lowpass, sits under everything. */
  bass(bus: GainNode, freq: number, t: number, dur: number, gain = 0.16, cutoff = 420) {
    this.tone(bus, freq, t, dur, { type: 'sawtooth', gain, attack: 0.006, release: dur * 0.5, cutoff });
    this.tone(bus, freq, t, dur, { type: 'square', gain: gain * 0.35, attack: 0.006, release: dur * 0.5, cutoff: cutoff * 0.7 });
  }

  /** Brassy chord stab. */
  stab(ch: GameChord, t: number, dur = 0.16, gain = 0.06, cutoff = 1800) {
    for (const f of ch.freqs) {
      this.tone(ch.bus, f, t, dur, { type: 'sawtooth', gain, attack: 0.005, release: dur * 0.7, cutoff, detune: -5 });
      this.tone(ch.bus, f, t, dur, { type: 'square', gain: gain * 0.5, attack: 0.005, release: dur * 0.7, cutoff, detune: 5 });
    }
  }

  kick(bus: GainNode, t: number, gain = 0.5) {
    this.tone(bus, 150, t, 0.16, { type: 'sine', gain, attack: 0.002, release: 0.12, to: 42 });
    this.tone(bus, 900, t, 0.02, { type: 'square', gain: gain * 0.12, attack: 0.001, release: 0.015, to: 200 });
  }

  tom(bus: GainNode, t: number, freq = 110, gain = 0.3) {
    this.tone(bus, freq * 1.5, t, 0.22, { type: 'sine', gain, attack: 0.002, release: 0.18, to: freq * 0.7 });
  }

  noiseHit(bus: GainNode, t: number, kind: 'snare' | 'hat' | 'hatOpen' | 'swell' | 'tick', gain = 0.2) {
    const ac = this.ac;
    const out = this.dest(bus);
    if (!ac || !out) return;
    const src = ac.createBufferSource();
    src.buffer = this.getNoise(ac);
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    let dur = 0.1;
    let attack = 0.002;
    if (kind === 'snare') {
      f.type = 'bandpass';
      f.frequency.value = 1900;
      f.Q.value = 0.7;
      dur = 0.14;
      // The "body" of the snare.
      this.tone(bus, 190, t, 0.09, { type: 'sine', gain: gain * 0.7, attack: 0.002, release: 0.07, to: 120 });
    } else if (kind === 'hat') {
      f.type = 'highpass';
      f.frequency.value = 7500;
      dur = 0.045;
    } else if (kind === 'hatOpen') {
      f.type = 'highpass';
      f.frequency.value = 6500;
      dur = 0.18;
    } else if (kind === 'tick') {
      f.type = 'bandpass';
      f.frequency.value = 3200;
      f.Q.value = 3;
      dur = 0.03;
    } else {
      f.type = 'lowpass';
      f.frequency.value = 900;
      dur = 1.6;
      attack = 1.1;
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  get tension() {
    return this.intensity;
  }

  /** Small helper so compositions can hand a bus + chord to `stab`. */
  chord(bus: GainNode, name: ChordName, octave = 0): GameChord {
    return { bus, freqs: CH[name].map(s => n(s + octave * 12)) };
  }
}

interface GameChord {
  bus: GainNode;
  freqs: number[];
}

/* ============================================================================
 * Compositions. All in A minor / C major. 16 steps per bar.
 * `play(m, t, step, abs, bar)`: step wraps per loop, abs never wraps.
 * ========================================================================== */

/** Deterministic pseudo-random for "humanised" but repeatable patterns. */
const hash = (a: number, b: number) => {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

const TITLE_CHORDS: ChordName[] = ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E'];
const RUN_CHORDS: ChordName[] = ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G'];
const SHOP_CHORDS: ChordName[] = ['C', 'Am', 'F', 'G', 'C', 'Em', 'F', 'G'];
const COMBAT_BASS = [A, A, A + 12, G, A, A, C, E, A, A, A + 12, G, F, F, E, E];
const BOSS_STABS: (readonly number[])[] = [
  [A, D + 1, A + 12], // tritone
  [A, B - 1 + 12, E], // flat 9
  [A, D + 1, G + 1]
];

const COMPOSITIONS: Record<MusicMode, Composition | null> = {
  off: null,

  /* Slow ambient: pad on every bar, sparse arpeggio through a long echo. */
  title: ({
    bpm: 72,
    bars: 8,
    echo: 0.35,
    play(m, b, t, step, abs, bar) {
      const secPerBar = (60 / 72) * 4;
      const ch = CH[TITLE_CHORDS[bar]];
      if (step === 0) {
        m.pad(b, ch.map(s => n(s)), t, secPerBar * 1.1, 0.035, 520);
        m.bass(b, n(ch[0] - 12), t, secPerBar * 0.95, 0.09, 260);
      }
      // Sparse arpeggio, different every pass but repeatable.
      const r = hash(abs, 11);
      const onGrid = step % 2 === 0;
      if (onGrid && r < 0.34) {
        const idx = Math.floor(hash(abs, 5) * 3);
        const oct = hash(abs, 7) < 0.5 ? 12 : 24;
        m.pluck(b, n(ch[idx] + oct), t, 0.045 + hash(abs, 9) * 0.03, 0.5);
      }
      // A far-away shimmer every other bar.
      if (step === 8 && bar % 2 === 1) m.pluck(b, n(ch[2] + 24), t, 0.03, 0.9);
    }
  }),

  /* Driving and hopeful: eighth-note bass, plucky arp, light hats. */
  run: ({
    bpm: 118,
    bars: 8,
    echo: 0.18,
    play(m, b, t, step, _abs, bar) {
      const ch = CH[RUN_CHORDS[bar]];
      const sps = 60 / 118 / 4;
      if (step % 2 === 0) {
        const root = ch[0] - 12;
        const note = step % 8 === 6 ? root + 12 : root;
        m.bass(b, n(note), t, sps * 1.7, 0.15, 380);
      }
      if (step === 0 || step === 8) m.kick(b, t, 0.38);
      if (step === 10) m.kick(b, t, 0.22);
      if (step === 4 || step === 12) m.noiseHit(b, t, 'snare', 0.12);
      if (step % 4 === 2) m.noiseHit(b, t, 'hat', 0.09);
      // Arp: root, fifth, octave, fifth on 16ths, skipping some for lift.
      const arp = [ch[0], ch[2], ch[0] + 12, ch[2], ch[1] + 12, ch[2], ch[0] + 12, ch[1]];
      if (step % 2 === 0 || bar % 4 === 3) {
        const idx = (step >> 1) % arp.length;
        m.pluck(b, n(arp[idx] + 12), t, 0.055, 0.22);
      }
      if (step === 0 && bar % 2 === 0) m.pad(b, ch.map(s => n(s + 12)), t, (60 / 118) * 8, 0.018, 900);
    }
  }),

  /* Four-on-the-floor with a bass riff; intensity layers hats/bass/motif. */
  combat: ({
    bpm: 132,
    bars: 8,
    play(m, b, t, step, abs, bar) {
      const k = m.tension;
      const sps = 60 / 132 / 4;
      if (step % 4 === 0) m.kick(b, t, 0.5);
      if (step === 10 && bar % 2 === 1) m.kick(b, t, 0.35);
      if (step === 4 || step === 12) m.noiseHit(b, t, 'snare', 0.2);
      if (step === 15 && bar % 4 === 3) m.noiseHit(b, t, 'snare', 0.12);
      // Hats: eighths at rest, sixteenths as tension rises.
      const hatEvery = k > 0.45 ? 1 : 2;
      if (step % hatEvery === 0 && (k > 0.12 || step % 4 === 2)) {
        m.noiseHit(b, t, step % 4 === 2 ? 'hatOpen' : 'hat', step % 4 === 2 ? 0.07 : 0.06);
      }
      // Bass riff on eighths.
      if (step % 2 === 0) {
        const note = COMBAT_BASS[step] - 12 + (bar % 4 === 3 ? -2 : 0);
        m.bass(b, n(note), t, sps * 1.8, 0.17, 460 + k * 500);
        if (k > 0.55) m.bass(b, n(note + 12), t, sps * 1.3, 0.07, 900);
      }
      // Stabs: Am on the one, Dm/E answering.
      if (step === 0) m.stab(m.chord(b, 'Am', 1), t, 0.18, 0.05);
      if (step === 6) m.stab(m.chord(b, bar % 2 ? 'E' : 'Dm', 1), t, 0.14, 0.045);
      if (step === 11 && bar % 4 === 3) m.stab(m.chord(b, 'F', 1), t, 0.22, 0.05);
      // High tension motif: E F E D# in 16ths on the back half.
      if (k > 0.7 && step >= 8 && step % 2 === 0) {
        const motif = [E, F, E, D + 1];
        m.pluck(b, n(motif[(step >> 1) % 4] + 36), t, 0.05 + hash(abs, 3) * 0.02, 0.12);
      }
    }
  }),

  /* Slower, heavier, dissonant: drone, tribal kick, tom rolls. */
  boss: ({
    bpm: 140,
    bars: 8,
    play(m, b, t, step, abs, bar) {
      const k = m.tension;
      const sps = 60 / 140 / 4;
      const secPerBar = sps * 16;
      if (step === 0) {
        // Low drone, retriggered per bar with overlap.
        m.tone(b, n(A - 24), t, secPerBar * 1.15, { type: 'sawtooth', gain: 0.11, attack: 0.4, release: 0.5, cutoff: 180 });
        m.tone(b, n(A - 24) * 1.005, t, secPerBar * 1.15, { type: 'square', gain: 0.05, attack: 0.4, release: 0.5, cutoff: 140 });
      }
      if ([0, 3, 6, 8, 11, 14].includes(step)) m.kick(b, t, step % 8 === 0 ? 0.55 : 0.4);
      if (step === 4 || step === 12) m.noiseHit(b, t, 'snare', 0.22);
      // Tom roll over the last bar of the loop, and (with tension) every 4th bar.
      const rollBar = bar === 7 || (k > 0.5 && bar === 3);
      if (rollBar && step >= 8) {
        const f = [110, 98, 87, 73][Math.floor((step - 8) / 2)] ?? 73;
        m.tom(b, t, f, 0.28 + (step - 8) * 0.02);
      }
      const hatEvery = k > 0.5 ? 1 : 2;
      if (k > 0.2 && step % hatEvery === 0) m.noiseHit(b, t, 'hat', 0.05);
      // Bass hits on the kick pattern.
      if ([0, 6, 8, 14].includes(step)) {
        const note = step === 14 ? G + 1 - 12 : A - 12;
        m.bass(b, n(note), t, sps * 2.5, 0.16, 380 + k * 400);
        if (k > 0.55) m.bass(b, n(note + 12), t, sps * 1.5, 0.06, 900);
      }
      // Dissonant stabs.
      if (step === 0 || step === 7 || (step === 10 && bar % 2 === 1)) {
        const set = BOSS_STABS[(bar + (step === 7 ? 1 : 0)) % BOSS_STABS.length];
        m.stab({ bus: b, freqs: set.map(s => n(s + 12)) }, t, 0.2, 0.05, 1400);
      }
      // Tension motif: Bb-A semitone wail high up.
      if (k > 0.7 && (step === 2 || step === 5 || step === 9 || step === 13)) {
        const up = hash(abs, 21) < 0.5;
        m.tone(b, n((up ? B - 1 : A) + 36), t, sps * 2, { type: 'square', gain: 0.045, attack: 0.01, release: 0.1, cutoff: 3000 });
      }
    }
  }),

  /* Gentle plucked lute, waltz-ish lilt. */
  shop: ({
    bpm: 96,
    bars: 8,
    echo: 0.22,
    play(m, b, t, step, abs, bar) {
      const ch = CH[SHOP_CHORDS[bar]];
      // Arpeggio in eighths: low root, then a rolling pattern.
      const pattern = [ch[0], ch[1] + 12, ch[2] + 12, ch[0] + 24, ch[2] + 12, ch[1] + 12, ch[0] + 12, ch[2]];
      if (step % 2 === 0) {
        const idx = step >> 1;
        const strum = hash(abs, 2) * 0.012; // tiny timing slop = fingers
        m.pluck(b, n(pattern[idx]), t + strum, idx === 0 ? 0.11 : 0.075, 0.42);
      }
      if (step === 0 || step === 8) m.tone(b, n(ch[0] - 12), t, 0.7, { type: 'sine', gain: 0.12, attack: 0.01, release: 0.4 });
      if (step === 4 || step === 12) m.noiseHit(b, t, 'tick', 0.05);
      // A lyrical top line on even bars.
      if (bar % 2 === 1 && (step === 3 || step === 9 || step === 14)) {
        m.pluck(b, n(ch[(step * 7) % 3] + 24), t, 0.06, 0.5);
      }
    }
  }),

  /* Two-bar fanfare, then a soft pad holds. */
  victory: ({
    bpm: 120,
    bars: 4,
    echo: 0.2,
    play(m, b, t, step, abs) {
      const sps = 60 / 120 / 4;
      if (abs < 32) {
        const fan: Record<number, number[]> = {
          0: [C],
          2: [E],
          4: [G],
          6: [C + 12],
          10: [G],
          12: [C + 12],
          16: [C + 12, E + 12, G + 12],
          24: [E + 12, G + 12, C + 24]
        };
        const notes = fan[abs];
        if (notes) {
          for (const s of notes) {
            const dur = abs >= 16 ? sps * 7 : abs === 12 ? sps * 4 : sps * 1.8;
            m.tone(b, n(s + 12), t, dur, { type: 'sawtooth', gain: 0.07, attack: 0.01, release: dur * 0.4, cutoff: 2200, detune: -4 });
            m.tone(b, n(s + 12), t, dur, { type: 'square', gain: 0.035, attack: 0.01, release: dur * 0.4, cutoff: 1800, detune: 4 });
          }
        }
        if (abs === 0 || abs === 16 || abs === 24) m.kick(b, t, 0.35);
        if (abs === 16 || abs === 24) m.noiseHit(b, t, 'snare', 0.16);
        if (abs === 16) m.noiseHit(b, t, 'swell', 0.05);
        return;
      }
      // After the fanfare: a calm C major pad every bar plus a slow sparkle.
      if (step === 0) m.pad(b, [n(C), n(E), n(G), n(C + 12)], t, (60 / 120) * 4.4, 0.03, 700);
      if (step === 8 && hash(abs, 4) < 0.6) m.pluck(b, n([C, E, G][abs % 3] + 24), t, 0.035, 0.7);
    }
  }),

  /* One low sting, then silence. */
  defeat: ({
    bpm: 90,
    bars: 1,
    stopAfterBars: 1,
    play(m, b, t, step) {
      if (step === 0) {
        m.tone(b, n(A - 24), t, 2.4, { type: 'sawtooth', gain: 0.18, attack: 0.02, release: 1.6, cutoff: 300, to: n(A - 26) });
        m.tone(b, n(D + 1 - 12), t, 2.0, { type: 'sawtooth', gain: 0.07, attack: 0.05, release: 1.4, cutoff: 500, to: n(D - 12) });
        m.kick(b, t, 0.5);
        m.noiseHit(b, t + 0.05, 'swell', 0.06);
      }
      if (step === 6) m.tom(b, t, 73, 0.3);
      if (step === 9) m.tom(b, t, 60, 0.3);
    }
  })
};

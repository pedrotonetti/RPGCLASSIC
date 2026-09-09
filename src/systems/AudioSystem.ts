/**
 * All sound in the game is synthesized at runtime via the Web Audio API —
 * no audio files to fetch, license, or ship. Every effect is built from a
 * handful of primitives (tone, sweep, noise burst, chord) tuned by ear.
 *
 * The AudioContext is created lazily on first use, which in practice means
 * "on the player's first click" — satisfying the browser autoplay policy
 * without any extra plumbing, since every sound call here is itself
 * triggered from a user gesture (a click, a key press in battle, etc).
 */

type OscType = OscillatorType;

class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private lastUiClickAt = 0;

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private context(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.32;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private noise(): AudioBuffer | null {
    const ctx = this.context();
    if (!ctx) return null;
    if (!this.noiseBuffer) {
      const length = ctx.sampleRate * 0.5;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  /** A single tone, optionally sweeping from one frequency to another. */
  private tone(opts: {
    freq: number;
    toFreq?: number;
    duration: number;
    type?: OscType;
    gain?: number;
    delay?: number;
    attack?: number;
  }): void {
    const ctx = this.context();
    if (!ctx || !this.master) return;
    const { freq, toFreq, duration, type = 'sine', gain = 0.25, delay = 0, attack = 0.005 } = opts;
    const start = ctx.currentTime + delay;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (toFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, toFreq), start + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /** A filtered burst of noise — good for percussive hits/impacts/whooshes. */
  private noiseBurst(opts: { duration: number; gain?: number; filterFreq?: number; filterType?: BiquadFilterType; delay?: number }): void {
    const ctx = this.context();
    const buffer = this.noise();
    if (!ctx || !buffer || !this.master) return;
    const { duration, gain = 0.3, filterFreq = 1200, filterType = 'lowpass', delay = 0 } = opts;
    const start = ctx.currentTime + delay;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    src.connect(filter).connect(env).connect(this.master);
    src.start(start);
    src.stop(start + duration + 0.02);
  }

  private chord(freqs: number[], duration: number, type: OscType = 'triangle', gain = 0.16, delay = 0): void {
    for (const f of freqs) this.tone({ freq: f, duration, type, gain, delay });
  }

  // --- UI -----------------------------------------------------------------

  uiClick(): void {
    // Guard against a burst of programmatic clicks (e.g. held keys) making
    // this feel like a machine gun of blips.
    const now = performance.now();
    if (now - this.lastUiClickAt < 40) return;
    this.lastUiClickAt = now;
    this.tone({ freq: 720, toFreq: 560, duration: 0.07, type: 'square', gain: 0.12 });
  }

  // --- combat ---------------------------------------------------------------

  attackSwing(): void {
    this.noiseBurst({ duration: 0.12, gain: 0.22, filterFreq: 2200, filterType: 'highpass' });
  }

  castSpell(): void {
    this.tone({ freq: 260, toFreq: 900, duration: 0.28, type: 'sawtooth', gain: 0.14 });
  }

  hitImpact(crit = false): void {
    this.noiseBurst({ duration: crit ? 0.22 : 0.13, gain: crit ? 0.4 : 0.28, filterFreq: crit ? 500 : 900 });
    this.tone({ freq: crit ? 140 : 110, toFreq: 60, duration: crit ? 0.22 : 0.12, type: 'square', gain: crit ? 0.22 : 0.14 });
    if (crit) this.tone({ freq: 1200, duration: 0.12, type: 'square', gain: 0.1, delay: 0.02 });
  }

  miss(): void {
    this.tone({ freq: 320, toFreq: 220, duration: 0.15, type: 'sine', gain: 0.1 });
  }

  heal(): void {
    this.chord([523, 659, 784], 0.35, 'sine', 0.12);
  }

  block(perfect: boolean): void {
    if (perfect) {
      this.tone({ freq: 900, toFreq: 1400, duration: 0.18, type: 'square', gain: 0.22 });
      this.noiseBurst({ duration: 0.08, gain: 0.2, filterFreq: 3000, filterType: 'highpass' });
    } else {
      this.noiseBurst({ duration: 0.1, gain: 0.22, filterFreq: 400 });
    }
  }

  dodge(): void {
    this.tone({ freq: 500, toFreq: 900, duration: 0.16, type: 'sine', gain: 0.14 });
  }

  stagger(): void {
    this.tone({ freq: 200, toFreq: 90, duration: 0.3, type: 'sawtooth', gain: 0.18 });
  }

  itemUse(): void {
    this.tone({ freq: 440, toFreq: 660, duration: 0.18, type: 'sine', gain: 0.14 });
  }

  enemyDefeated(): void {
    this.tone({ freq: 300, toFreq: 60, duration: 0.35, type: 'sawtooth', gain: 0.16 });
  }

  levelUp(): void {
    this.chord([523, 659, 784], 0.18, 'triangle', 0.16);
    this.chord([659, 784, 988], 0.4, 'triangle', 0.16, 0.16);
  }

  victory(): void {
    this.chord([392, 494, 587], 0.2, 'triangle', 0.14);
    this.chord([523, 659, 784], 0.5, 'triangle', 0.16, 0.2);
  }

  defeat(): void {
    this.chord([220, 185, 147], 0.7, 'sawtooth', 0.14, 0);
  }

  flee(): void {
    this.tone({ freq: 700, toFreq: 200, duration: 0.3, type: 'sine', gain: 0.14 });
  }

  telegraphWarning(): void {
    this.tone({ freq: 880, duration: 0.09, type: 'square', gain: 0.08 });
  }

  // --- overworld ------------------------------------------------------------

  encounterStart(): void {
    this.tone({ freq: 220, toFreq: 440, duration: 0.25, type: 'sawtooth', gain: 0.16 });
    this.tone({ freq: 330, toFreq: 660, duration: 0.25, type: 'sawtooth', gain: 0.12, delay: 0.05 });
  }

  npcTalk(): void {
    this.tone({ freq: 500, duration: 0.05, type: 'square', gain: 0.08 });
  }

  mountToggle(): void {
    this.tone({ freq: 300, toFreq: 500, duration: 0.2, type: 'triangle', gain: 0.14 });
  }

  questComplete(): void {
    this.chord([659, 784, 988], 0.4, 'triangle', 0.15);
  }
}

/** Single shared instance — the whole game plays sound through this. */
export const audio = new AudioSystem();

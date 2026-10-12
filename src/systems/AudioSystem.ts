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

import { AMBIENT_LAYERS, crossfadeGain, emptyAmbientGains, type AmbientGains, type AmbientLayerId } from './ambientAudio';

type OscType = OscillatorType;

/** One running continuous ambient layer (see AudioSystem.buildAmbientLayer) — `gain` is what setAmbientTargets ramps; `sources` are every node it must stop on teardown. */
interface AmbientLayerVoice {
  gain: GainNode;
  sources: AudioScheduledSourceNode[];
}

/** Layers built from looping noise/oscillators that run continuously; the rest (birds/insects/crickets/drips) are sparse one-shots scheduled by tickAmbient. */
const CONTINUOUS_AMBIENT_LAYERS: ReadonlySet<AmbientLayerId> = new Set<AmbientLayerId>(['wind', 'leaves', 'water', 'murmur', 'drone', 'eerie']);
/** Each layer's loudness at mix level 1 — tuned by ear against the existing combat cues so a full bed sits clearly underneath them. */
const AMBIENT_BASE_LEVEL: Record<AmbientLayerId, number> = {
  wind: 0.16,
  leaves: 0.05,
  water: 0.09,
  murmur: 0.07,
  drone: 0.07,
  eerie: 0.02,
  birds: 0.035,
  insects: 0.012,
  crickets: 0.02,
  drips: 0.05,
};
/** Expected one-shots per second at mix level 1 for the scheduled layers. */
const AMBIENT_EVENT_RATE: Partial<Record<AmbientLayerId, number>> = { birds: 0.9, insects: 0.5, crickets: 1.6, drips: 0.7 };
const AMBIENT_TICK_MS = 200;
/** Once every target has been ~0 this long, the continuous layers are stopped outright so a silent bed costs nothing. */
const AMBIENT_IDLE_TEARDOWN_S = 6;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

class AudioSystem {
  private ctx: AudioContext | null = null;
  /** Final, fixed overall level — never user-adjustable directly; musicGain/sfxGain (below) are the two independently user-adjustable buses that feed into it, so their sliders scale relative to this same baseline loudness the game always had. */
  private master: GainNode | null = null;
  /** Everything scheduleThemeNote/startTheme's drone plays through — see setMusicVolume. */
  private musicGain: GainNode | null = null;
  /** Every one-shot cue below (combat/UI/overworld) plays through this by default — see setSfxVolume. */
  private sfxGain: GainNode | null = null;
  private musicVolume = 1;
  private sfxVolume = 1;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private lastUiClickAt = 0;
  private themeVoices: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  private themeTimer: ReturnType<typeof setTimeout> | null = null;
  private themePlaying = false;
  /** Fase 7 ambient bus — every ambient layer feeds this; see setAmbientVolume. */
  private ambientGain: GainNode | null = null;
  private ambientVolume = 1;
  private ambientNoiseBuffer: AudioBuffer | null = null;
  private ambientVoices: Partial<Record<AmbientLayerId, AmbientLayerVoice>> = {};
  private ambientTargets: AmbientGains = emptyAmbientGains();
  /** JS-side smoothed level of the scheduled (one-shot) layers — the continuous ones are smoothed by Web Audio's own setTargetAtTime instead. */
  private ambientEventLevels: AmbientGains = emptyAmbientGains();
  private ambientFadeTau = 1.2;
  private ambientTimer: ReturnType<typeof setInterval> | null = null;
  private ambientSilentFor = 0;

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ambientGain) this.ambientGain.gain.value = muted ? 0 : this.ambientVolume;
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** 0..1 — see systems/GameSettings.ts, the persisted source of truth this mirrors at startup and on every settings-screen change. */
  setMusicVolume(v: number): void {
    this.musicVolume = clamp01(v);
    if (this.musicGain) this.musicGain.gain.value = this.musicVolume;
  }

  getMusicVolume(): number {
    return this.musicVolume;
  }

  /** 0..1 — see systems/GameSettings.ts. */
  setSfxVolume(v: number): void {
    this.sfxVolume = clamp01(v);
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVolume;
  }

  getSfxVolume(): number {
    return this.sfxVolume;
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
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.master);
      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.value = this.ambientVolume;
      this.ambientGain.connect(this.master);
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

  /** A single tone, optionally sweeping from one frequency to another. `destination` defaults to sfxGain — only scheduleThemeNote (music) ever overrides it to musicGain. */
  private tone(opts: {
    freq: number;
    toFreq?: number;
    duration: number;
    type?: OscType;
    gain?: number;
    delay?: number;
    attack?: number;
    destination?: GainNode;
  }): void {
    const ctx = this.context();
    const dest = opts.destination ?? this.sfxGain;
    if (!ctx || !dest) return;
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

    osc.connect(env).connect(dest);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  /** A filtered burst of noise — good for percussive hits/impacts/whooshes. Always sfxGain — no music cue currently uses it. */
  private noiseBurst(opts: { duration: number; gain?: number; filterFreq?: number; filterType?: BiquadFilterType; delay?: number }): void {
    const ctx = this.context();
    const buffer = this.noise();
    if (!ctx || !buffer || !this.sfxGain) return;
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

    src.connect(filter).connect(env).connect(this.sfxGain);
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

  /** A boss crossing into a new scripted phase (see systems/BossPhaseSystem.ts) — a low rumble under a dissonant rising chord, distinct from any other combat cue so a phase change reads as its own kind of moment. */
  bossPhaseChange(): void {
    this.noiseBurst({ duration: 0.4, gain: 0.2, filterFreq: 350, filterType: 'lowpass' });
    this.tone({ freq: 130, toFreq: 55, duration: 0.6, type: 'sawtooth', gain: 0.2 });
    this.chord([220, 262, 311], 0.35, 'sawtooth', 0.14, 0.12);
  }

  /** Fase 7: the heavier half of a boss phase change, layered on top of bossPhaseChange — a deep sub "boom" and a delayed metallic ring, timed with the hit-stop freeze (see systems/combatFeel.ts). */
  bossPhaseStinger(): void {
    this.tone({ freq: 70, toFreq: 32, duration: 0.9, type: 'sine', gain: 0.32, attack: 0.01 });
    this.noiseBurst({ duration: 0.6, gain: 0.18, filterFreq: 180, filterType: 'lowpass', delay: 0.02 });
    this.tone({ freq: 1567, toFreq: 1480, duration: 1.1, type: 'triangle', gain: 0.05, delay: 0.25, attack: 0.02 });
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

  /** A short "coins + creak" cue for opening a hidden chest (see OverworldScreen.openChest) — brighter/quicker than questComplete so the two never sound alike. */
  chestOpen(): void {
    this.tone({ freq: 260, toFreq: 180, duration: 0.12, type: 'triangle', gain: 0.1 });
    this.tone({ freq: 880, duration: 0.06, type: 'square', gain: 0.1, delay: 0.08 });
    this.tone({ freq: 1180, duration: 0.08, type: 'square', gain: 0.09, delay: 0.15 });
  }

  /** A hidden-secret-found cue for the title screen's easter eggs (see MainMenuScreen) — a low creak sliding into a bright, slightly dissonant chime, distinct from questComplete/chestOpen's warmer resolutions so a found secret reads as its own eerie kind of reward. */
  secretFound(): void {
    this.noiseBurst({ duration: 0.3, gain: 0.12, filterFreq: 500, filterType: 'lowpass' });
    this.tone({ freq: 90, toFreq: 60, duration: 0.5, type: 'sawtooth', gain: 0.14 });
    this.chord([622, 740, 932], 0.6, 'sine', 0.12, 0.2);
  }

  // --- title theme ------------------------------------------------------

  /**
   * A soft, mysterious ambient loop for the title screen: an open-fifth
   * drone (two low tones a fifth apart, each breathing slowly via its own
   * LFO-modulated gain) under a sparse, randomly-picked bell melody in a
   * D dorian scale — deliberately unresolved, nothing lands on a strong
   * tonic chord, for a "light but unsettled" mood rather than a hummable
   * tune. Idempotent: calling it while already playing does nothing.
   */
  startTheme(): void {
    if (this.themePlaying) return;
    const ctx = this.context();
    const musicDest = this.musicGain;
    if (!ctx || !musicDest) return;
    this.themePlaying = true;

    const drone: Array<{ freq: number; gain: number; lfoRate: number }> = [
      { freq: 146.83, gain: 0.05, lfoRate: 0.055 }, // D3
      { freq: 220.0, gain: 0.032, lfoRate: 0.047 }, // A3 — open fifth above
      { freq: 293.66, gain: 0.02, lfoRate: 0.04 }, // D4 — faint upper octave
    ];
    for (const voice of drone) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = voice.freq;

      const gain = ctx.createGain();
      gain.gain.value = voice.gain * 0.6;

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = voice.lfoRate;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = voice.gain * 0.4;
      lfo.connect(lfoDepth).connect(gain.gain);

      osc.connect(gain).connect(musicDest);
      osc.start();
      lfo.start();
      this.themeVoices.push({ osc, gain }, { osc: lfo, gain: lfoDepth });
    }

    this.scheduleThemeNote();
  }

  private scheduleThemeNote(): void {
    if (!this.themePlaying) return;
    const scale = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33]; // D E F A C D (dorian-flavored), one octave up from the drone
    const freq = scale[Math.floor(Math.random() * scale.length)];
    this.tone({ freq, duration: 2.2, type: 'sine', gain: 0.05, attack: 0.7, destination: this.musicGain ?? undefined });
    const nextInMs = 2400 + Math.random() * 2800;
    this.themeTimer = setTimeout(() => this.scheduleThemeNote(), nextInMs);
  }

  /** Fades the theme out and tears down its nodes. Safe to call even if it isn't playing. */
  stopTheme(): void {
    if (!this.themePlaying) return;
    this.themePlaying = false;
    if (this.themeTimer !== null) {
      clearTimeout(this.themeTimer);
      this.themeTimer = null;
    }
    const ctx = this.ctx;
    const now = ctx?.currentTime ?? 0;
    for (const { osc, gain } of this.themeVoices) {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + 1.0);
        osc.stop(now + 1.05);
      } catch {
        // Already stopped — nothing to unwind.
      }
    }
    this.themeVoices = [];
  }

  isThemePlaying(): boolean {
    return this.themePlaying;
  }

  // --- ambient beds (Fase 7) ---------------------------------------------
  //
  // WHICH layers play and how loud is decided by systems/ambientAudio.ts
  // (pure, tested); this section only synthesizes them. Continuous layers
  // (wind/leaves/water/murmur/drone/eerie) are filtered noise loops or
  // detuned oscillators whose gain is eased with setTargetAtTime — the
  // crossfade happens on the audio thread, no per-frame JS. Sparse layers
  // (birds/insects/crickets/drips) are one-shot tones scheduled from a
  // single low-rate timer while the bed is audible.

  /** 0..1 — see systems/GameSettings.ts's ambientVolume. */
  setAmbientVolume(v: number): void {
    this.ambientVolume = clamp01(v);
    if (this.ambientGain && !this.muted) this.ambientGain.gain.value = this.ambientVolume;
  }

  getAmbientVolume(): number {
    return this.ambientVolume;
  }

  /** The mix the bed is currently easing toward — read-only snapshot for tests/debugging. */
  getAmbientTargets(): Readonly<AmbientGains> {
    return this.ambientTargets;
  }

  /**
   * Eases every ambient layer toward `targets` (0..1 mix levels, see
   * ambientAudio.ambientLayerGains) with time constant `fadeTau` seconds.
   * Calling it again mid-fade simply retargets from wherever each layer is
   * now — that IS the crossfade between zones or between day and night.
   */
  setAmbientTargets(targets: Readonly<AmbientGains>, fadeTau = 1.2): void {
    for (const id of AMBIENT_LAYERS) this.ambientTargets[id] = clamp01(targets[id] ?? 0);
    this.ambientFadeTau = Math.max(0.05, fadeTau);
    const anyAudible = AMBIENT_LAYERS.some((id) => this.ambientTargets[id] > 0.001);
    if (!anyAudible && !this.ambientTimer) return;
    const ctx = this.context();
    if (!ctx || !this.ambientGain) return;
    const now = ctx.currentTime;
    for (const id of AMBIENT_LAYERS) {
      if (!CONTINUOUS_AMBIENT_LAYERS.has(id)) continue;
      const target = this.ambientTargets[id] * AMBIENT_BASE_LEVEL[id];
      let voice = this.ambientVoices[id];
      if (!voice) {
        if (target <= 0.0001) continue;
        voice = this.buildAmbientLayer(ctx, id) ?? undefined;
        if (!voice) continue;
        this.ambientVoices[id] = voice;
      }
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.setTargetAtTime(target, now, this.ambientFadeTau);
    }
    if (anyAudible) this.ambientSilentFor = 0;
    this.ensureAmbientTicker();
  }

  /** Fades the whole bed to silence (it tears itself down once silent — see tickAmbient). */
  fadeOutAmbient(fadeTau = 0.8): void {
    this.setAmbientTargets(emptyAmbientGains(), fadeTau);
  }

  isAmbientActive(): boolean {
    return this.ambientTimer !== null;
  }

  /** A 2s noise loop (longer than the 0.5s one-shot buffer so the loop point isn't audible as a rhythm). */
  private ambientNoise(ctx: AudioContext): AudioBuffer {
    if (!this.ambientNoiseBuffer) {
      const length = Math.floor(ctx.sampleRate * 2);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      // Lightly brown-ish (integrated) noise: softer, more "air" than hiss.
      let last = 0;
      for (let i = 0; i < length; i++) {
        last = (last + 0.08 * (Math.random() * 2 - 1)) * 0.985;
        data[i] = last * 3.2 + (Math.random() * 2 - 1) * 0.25;
      }
      // Crossfade the tail into the head so the loop seam isn't a click.
      const seam = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < seam; i++) {
        const t = i / seam;
        data[length - seam + i] = data[length - seam + i] * (1 - t) + data[i] * t;
      }
      this.ambientNoiseBuffer = buffer;
    }
    return this.ambientNoiseBuffer;
  }

  private buildAmbientLayer(ctx: AudioContext, id: AmbientLayerId): AmbientLayerVoice | null {
    const dest = this.ambientGain;
    if (!dest) return null;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(dest);
    const sources: AudioScheduledSourceNode[] = [];

    const noiseLoop = (filterType: BiquadFilterType, freq: number, q: number, rate = 1): BiquadFilterNode => {
      const src = ctx.createBufferSource();
      src.buffer = this.ambientNoise(ctx);
      src.loop = true;
      src.playbackRate.value = rate;
      // Random start offset so two layers sharing the buffer don't phase-lock.
      src.start(ctx.currentTime, Math.random() * 1.9);
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = freq;
      filter.Q.value = q;
      src.connect(filter);
      sources.push(src);
      return filter;
    };
    const lfo = (rate: number, depth: number, param: AudioParam): void => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = rate;
      const amt = ctx.createGain();
      amt.gain.value = depth;
      osc.connect(amt).connect(param);
      osc.start();
      sources.push(osc);
    };
    /** Routes `input` into `out` through a slow LFO-driven swell between (1 - depth)..1. */
    const swell = (input: AudioNode, rate: number, depth: number): void => {
      const g = ctx.createGain();
      g.gain.value = 1 - depth / 2;
      lfo(rate, depth / 2, g.gain);
      input.connect(g).connect(out);
    };

    switch (id) {
      case 'wind': {
        const f = noiseLoop('lowpass', 420, 0.8, 0.6);
        lfo(0.07, 260, f.frequency);
        swell(f, 0.11, 0.6);
        break;
      }
      case 'leaves': {
        const f = noiseLoop('bandpass', 2600, 0.7);
        swell(f, 0.23, 0.8);
        break;
      }
      case 'water': {
        const f = noiseLoop('bandpass', 950, 0.6, 1.1);
        lfo(2.7, 180, f.frequency);
        swell(f, 0.4, 0.3);
        break;
      }
      case 'murmur': {
        const f = noiseLoop('bandpass', 380, 1.4, 0.8);
        lfo(0.9, 90, f.frequency);
        swell(f, 0.33, 0.7);
        break;
      }
      case 'drone': {
        const voices: Array<[number, number]> = [
          [55, -4],
          [82.4, 5],
        ];
        for (const [freq, detune] of voices) {
          const osc = ctx.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = freq;
          osc.detune.value = detune;
          osc.start();
          sources.push(osc);
          swell(osc, 0.05 + freq / 4000, 0.5);
        }
        break;
      }
      case 'eerie': {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        for (const freq of [311.1, 329.6]) {
          const osc = ctx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.value = freq;
          osc.connect(lp);
          osc.start();
          sources.push(osc);
        }
        swell(lp, 0.06, 0.9);
        break;
      }
      default:
        out.disconnect();
        return null;
    }
    return { gain: out, sources };
  }

  private ensureAmbientTicker(): void {
    if (this.ambientTimer || typeof window === 'undefined') return;
    this.ambientTimer = setInterval(() => this.tickAmbient(AMBIENT_TICK_MS / 1000), AMBIENT_TICK_MS);
  }

  private tickAmbient(dt: number): void {
    let audible = false;
    for (const id of AMBIENT_LAYERS) {
      if (this.ambientTargets[id] > 0.001) audible = true;
      const rate = AMBIENT_EVENT_RATE[id];
      if (rate === undefined) continue;
      const level = crossfadeGain(this.ambientEventLevels[id], this.ambientTargets[id], dt, this.ambientFadeTau);
      this.ambientEventLevels[id] = level;
      if (level > 0.01 && Math.random() < rate * level * dt) this.playAmbientOneShot(id, level);
    }
    if (audible) {
      this.ambientSilentFor = 0;
      return;
    }
    this.ambientSilentFor += dt;
    if (this.ambientSilentFor >= AMBIENT_IDLE_TEARDOWN_S) this.teardownAmbient();
  }

  private playAmbientOneShot(id: AmbientLayerId, level: number): void {
    const dest = this.ambientGain ?? undefined;
    if (!dest) return;
    const g = AMBIENT_BASE_LEVEL[id] * (0.6 + 0.4 * level);
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    switch (id) {
      case 'birds': {
        // A short phrase of 2-4 quick whistles, all rising or all falling.
        const base = rnd(2200, 3600);
        const notes = 2 + Math.floor(Math.random() * 3);
        const dir = Math.random() < 0.5 ? 1.25 : 0.8;
        for (let i = 0; i < notes; i++) {
          const f = base * (1 + (Math.random() - 0.5) * 0.15);
          this.tone({ freq: f, toFreq: f * dir, duration: rnd(0.06, 0.12), type: 'sine', gain: g, delay: i * rnd(0.09, 0.15), attack: 0.01, destination: dest });
        }
        break;
      }
      case 'insects':
        this.tone({ freq: rnd(4200, 5200), duration: rnd(0.25, 0.5), type: 'sawtooth', gain: g, attack: 0.08, destination: dest });
        break;
      case 'crickets': {
        const f = rnd(3900, 4500);
        for (let i = 0; i < 3; i++) this.tone({ freq: f, duration: 0.035, type: 'sine', gain: g, delay: i * 0.065, attack: 0.004, destination: dest });
        break;
      }
      case 'drips': {
        const f = rnd(900, 1500);
        this.tone({ freq: f, toFreq: f * 0.45, duration: 0.09, type: 'sine', gain: g, attack: 0.002, destination: dest });
        // A softer echo off the cave walls.
        this.tone({ freq: f, toFreq: f * 0.45, duration: 0.09, type: 'sine', gain: g * 0.35, delay: rnd(0.14, 0.22), attack: 0.002, destination: dest });
        break;
      }
      default:
        break;
    }
  }

  /** Stops and disconnects every continuous layer and the ticker — the next setAmbientTargets rebuilds whatever it needs. */
  private teardownAmbient(): void {
    if (this.ambientTimer) {
      clearInterval(this.ambientTimer);
      this.ambientTimer = null;
    }
    for (const id of AMBIENT_LAYERS) {
      const voice = this.ambientVoices[id];
      if (!voice) continue;
      for (const src of voice.sources) {
        try {
          src.stop();
        } catch {
          // Already stopped.
        }
        src.disconnect();
      }
      voice.gain.disconnect();
      delete this.ambientVoices[id];
    }
    this.ambientEventLevels = emptyAmbientGains();
    this.ambientSilentFor = 0;
  }
}

/** Single shared instance — the whole game plays sound through this. */
export const audio = new AudioSystem();

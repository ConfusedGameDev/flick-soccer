// All sound is synthesized with WebAudio: no audio files, as in Claw Island.
// The context is created on the first user gesture (iOS requirement).

const MUTE_KEY = 'flicksoccer.mute';
/** Level of the stadium murmur loop (30% of the original 0.045) and how much it breathes. */
const CROWD_GAIN = 0.0135;
const CROWD_SWELL = 0.006;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: { gain: GainNode; src: AudioBufferSourceNode; lfo: OscillatorNode } | null = null;
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* ignore */
    }
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchend', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master) this.master.gain.value = m ? 0 : 1;
  }

  /** Create or resume the context; safe to call often. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** The app went to the background: stop everything, including the crowd loop, until resume(). */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** The app is back in front. (A tap would also resume through unlock().) */
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; at?: number; slide?: number; vibrato?: number } = {}): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = this.now + (opts.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + opts.slide), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.15, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = opts.vibrato;
      const lg = ctx.createGain();
      lg.gain.value = freq * 0.03;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(t0);
      lfo.stop(t0 + dur);
    }
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, opts: { gain?: number; at?: number; lowpass?: number; highpass?: number; attack?: number } = {}): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t0 = this.now + (opts.at ?? 0);
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let node: AudioNode = src;
    if (opts.lowpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.lowpass;
      node.connect(f);
      node = f;
    }
    if (opts.highpass) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = opts.highpass;
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(opts.gain ?? 0.2, t0 + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    node.connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  // ---- Cues ----

  click(): void {
    this.tone(880, 0.05, { type: 'square', gain: 0.05 });
  }

  whistle(long = false): void {
    const d = long ? 0.7 : 0.25;
    this.tone(2200, d, { type: 'square', gain: 0.12, vibrato: 28 });
    this.tone(2750, d, { type: 'square', gain: 0.06, vibrato: 28 });
    if (long) {
      this.tone(2200, 0.35, { type: 'square', gain: 0.12, at: d + 0.1, vibrato: 28 });
    }
  }

  kick(strength = 0.5): void {
    this.noise(0.08 + strength * 0.08, { gain: 0.25 + strength * 0.3, lowpass: 600 + strength * 900 });
    this.tone(90, 0.12, { type: 'sine', gain: 0.2 + strength * 0.2, slide: -50 });
  }

  tackle(): void {
    this.noise(0.18, { gain: 0.35, lowpass: 500 });
    this.tone(70, 0.2, { type: 'sine', gain: 0.25, slide: -40 });
  }

  goal(): void {
    // Crowd roar swell plus a stadium horn, then the terraces cheering.
    this.noise(2.2, { gain: 0.5, lowpass: 1800, highpass: 200, attack: 0.25 });
    for (let i = 0; i < 3; i++) this.tone(196 + i * 2, 1.4, { type: 'sawtooth', gain: 0.05, at: 0.15 + i * 0.03 });
    this.cheer(true);
  }

  save(): void {
    this.noise(1.0, { gain: 0.35, lowpass: 1200, highpass: 250, attack: 0.08 });
    this.tone(520, 0.5, { type: 'triangle', gain: 0.08, slide: -220 });
    this.cheer(false);
  }

  /**
   * People cheering: a few waves of band-limited noise rising one after the
   * other, a handful of detuned "voices" and a swell of the murmur loop. `big`
   * is the goal celebration; small is the short applause after a save.
   */
  private cheer(big: boolean): void {
    if (!this.ctx || !this.master) return;
    const waves = big ? 4 : 2;
    for (let i = 0; i < waves; i++) {
      const at = 0.2 + i * (big ? 0.45 : 0.3);
      this.noise(big ? 2.6 - i * 0.3 : 1.2, { gain: (big ? 0.4 : 0.25) * (1 - i * 0.12), at, lowpass: 2200, highpass: 300, attack: big ? 0.3 : 0.15 });
    }
    // Voices: triangle tones spread over two octaves, each wobbling and sliding up a touch.
    const voices = big ? 6 : 3;
    for (let i = 0; i < voices; i++) {
      const freq = 330 * Math.pow(2, (i * 5 + 1) / 12) * (1 + (Math.random() - 0.5) * 0.04);
      this.tone(freq, big ? 1.6 : 0.8, { type: 'triangle', gain: big ? 0.03 : 0.02, at: 0.25 + i * 0.07, slide: freq * 0.08, vibrato: 6 });
    }
    // Lift the ambience with the cheer, then let it settle back to the murmur level.
    if (this.crowd) {
      const g = this.crowd.gain.gain;
      const base = CROWD_GAIN;
      const t0 = this.now;
      g.cancelScheduledValues(t0);
      g.setValueAtTime(base, t0);
      g.linearRampToValueAtTime(base * (big ? 5 : 3), t0 + 0.4);
      g.linearRampToValueAtTime(base, t0 + (big ? 2.8 : 1.4));
    }
  }

  dice(): void {
    for (let i = 0; i < 7; i++) this.noise(0.04, { gain: 0.25, at: i * 0.07 + Math.random() * 0.02, highpass: 1800 });
  }

  countdown(step: number): void {
    this.tone(step === 0 ? 1320 : 660, step === 0 ? 0.35 : 0.12, { type: 'square', gain: 0.12 });
  }

  mash(): void {
    this.tone(440 + Math.random() * 120, 0.04, { type: 'square', gain: 0.05 });
  }

  /** Low crowd murmur; call once per match and stop at the end. */
  crowdStart(): void {
    if (!this.ctx || !this.master || this.crowd) return;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = CROWD_GAIN;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = CROWD_SWELL;
    lfo.connect(lg).connect(gain.gain);
    lfo.start();
    src.connect(f).connect(gain).connect(this.master);
    src.start();
    this.crowd = { gain, src, lfo };
  }

  crowdStop(): void {
    if (!this.crowd || !this.ctx) return;
    const { gain, src, lfo } = this.crowd;
    gain.gain.cancelScheduledValues(this.now);
    gain.gain.setValueAtTime(gain.gain.value, this.now);
    gain.gain.linearRampToValueAtTime(0, this.now + 0.5);
    setTimeout(() => {
      src.stop();
      lfo.stop();
    }, 600);
    this.crowd = null;
  }
}

import { bloomVoice } from '../ui/ChainSummary';
/** Synthesised sound effects (no audio files). Voice-capped; silent until the first user gesture. */
const PENTA = [0, 2, 4, 7, 9];

export class Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private musicGain?: GainNode;
  /** Phase 4 E03.4: effects have their own gain, so sound and music switch and scale separately. */
  private sfxGain?: GainNode;
  /** 0..1 */
  sfxVolume = 1;
  musicVolume = 1;
  private voices = 0;
  private maxVoices = 12;
  muted = false;
  music = true;
  private musicTimer = 0;
  private bar = 0;
  layers = 0; // 0..3, grows with restoration

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.muted ? 0 : this.sfxVolume;
      this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.music ? 0.22 * this.musicVolume : 0;
      this.musicGain.connect(this.master);
    } catch {
      this.ctx = undefined;
    }
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.sfxGain && this.ctx) this.sfxGain.gain.setTargetAtTime(m ? 0 : this.sfxVolume, this.ctx.currentTime, 0.05);
  }

  /** Volumes 0..1 for effects and music (Settings sliders). */
  setVolumes(sfx: number, music: number) {
    this.sfxVolume = Math.max(0, Math.min(1, sfx));
    this.musicVolume = Math.max(0, Math.min(1, music));
    this.setMuted(this.muted);
    this.setMusic(this.music);
  }

  setMusic(on: boolean) {
    this.music = on;
    if (this.musicGain && this.ctx) this.musicGain.gain.setTargetAtTime(on ? 0.22 * this.musicVolume : 0, this.ctx.currentTime, 0.2);
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; attack?: number; glide?: number; delay?: number; dest?: AudioNode } = {}) {
    const ctx = this.ctx;
    const music = !!opts.dest && opts.dest === this.musicGain;
    if (!ctx || !this.master || (this.muted && !music)) return;
    if (this.voices >= this.maxVoices) return;
    this.voices++;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.glide), t0 + dur);
    const v = opts.vol ?? 0.2;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + (opts.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(opts.dest ?? this.sfxGain ?? this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    o.onended = () => this.voices--;
  }

  private noise(dur: number, vol: number, freq: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || this.voices >= this.maxVoices) return;
    this.voices++;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(freq * 3, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.sfxGain ?? this.master);
    src.start();
    src.onended = () => this.voices--;
  }

  note(step: number, base = 523.25) {
    const oct = Math.floor(step / 5);
    const semis = PENTA[((step % 5) + 5) % 5] + oct * 12;
    return base * Math.pow(2, semis / 12);
  }

  pulse() {
    this.noise(0.25, 0.12, 600);
    this.tone(330, 0.25, { glide: 2, vol: 0.12, type: 'triangle' });
  }
  restored(n = 0) {
    this.tone(this.note(n % 5), 0.35, { vol: 0.14, type: 'triangle' });
    this.tone(this.note((n % 5) + 2), 0.3, { vol: 0.06, delay: 0.04 });
  }
  nurture(level: number) {
    this.tone(this.note(level * 2), 0.4, { vol: 0.14, type: 'triangle' });
    this.tone(this.note(level * 2 + 2), 0.45, { vol: 0.1, delay: 0.07 });
  }
  private lastBloom = -1;
  /** City 10.6: blooms change pitch and texture with the combo instead of stacking (see bloomVoice). */
  bloom(combo: number) {
    const now = performance.now() / 1000;
    const v = bloomVoice(combo, now, this.lastBloom);
    if (!v) return;
    this.lastBloom = now;
    const f = this.note(v.step);
    this.tone(f, 0.5, { vol: v.vol, type: v.type });
    this.tone(f * 2, 0.3, { vol: v.octave ? 0.07 : 0.05, type: 'triangle' });
  }
  chainEnd(combo: number) {
    const n = combo >= 10 ? 5 : combo >= 5 ? 4 : 3;
    for (let i = 0; i < n; i++) this.tone(this.note(i * 2 + 2), 0.5, { vol: 0.12, delay: i * 0.08, type: 'triangle' });
  }
  build() {
    this.tone(140, 0.3, { glide: 0.5, vol: 0.3 });
    this.tone(880, 0.12, { vol: 0.08, delay: 0.12, type: 'square' });
    this.tone(1320, 0.2, { vol: 0.06, delay: 0.2 });
  }
  powerUp() {
    this.tone(330, 0.25, { glide: 2, vol: 0.08, type: 'triangle' });
    this.tone(this.note(7), 0.35, { vol: 0.09, delay: 0.18 });
  }
  coin() {
    this.tone(988, 0.1, { vol: 0.08, type: 'square' });
    this.tone(1319, 0.25, { vol: 0.08, delay: 0.08, type: 'square' });
  }
  error() {
    this.tone(220, 0.15, { vol: 0.08, type: 'triangle' });
    this.tone(196, 0.2, { vol: 0.06, delay: 0.08, type: 'triangle' });
  }
  click() {
    this.tone(1200, 0.05, { vol: 0.05, type: 'triangle' });
  }
  meow(quiet = false) {
    const v = quiet ? 0.035 : 0.09;
    this.tone(720, 0.18, { type: 'sawtooth', vol: v * 0.5, glide: 1.3 });
    this.tone(930, 0.35, { type: 'triangle', vol: v, glide: 0.62, delay: 0.12 });
  }
  fanfare() {
    [0, 2, 4, 5, 7, 9].forEach((s, i) => this.tone(this.note(s, 392), 0.7, { vol: 0.13, delay: i * 0.12, type: 'triangle' }));
    this.tone(this.note(10, 392), 1.5, { vol: 0.12, delay: 0.8 });
  }
  drone() {
    this.tone(660, 0.12, { vol: 0.04, glide: 1.5, type: 'triangle' });
  }

  /** Gentle generative pad; layers grow with the garden. */
  update(dt: number) {
    if (!this.ctx || !this.musicGain || !this.music) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 2.4;
    const roots = [0, 3, 1, 4];
    const r = roots[this.bar++ % roots.length];
    const base = 196;
    for (const s of [r, r + 2, r + 4]) this.tone(this.note(s, base), 2.6, { vol: 0.08, attack: 0.6, dest: this.musicGain });
    if (this.layers >= 1) this.tone(this.note(r + 5 + (this.bar % 3), base * 2), 1.2, { vol: 0.05, attack: 0.05, delay: 0.6, dest: this.musicGain, type: 'triangle' });
    if (this.layers >= 2) this.tone(this.note(r + 7, base * 2), 0.9, { vol: 0.04, delay: 1.5, dest: this.musicGain, type: 'triangle' });
    if (this.layers >= 3) this.tone(this.note(r, base / 2), 2.4, { vol: 0.07, attack: 0.3, dest: this.musicGain });
  }
}

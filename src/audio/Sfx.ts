import { AudioDirector, type V3 } from './AudioDirector';
import { variants } from './AudioAssets';
import { type AreaSound, type BusId, chainTone, DEAD_AREA, duckFor, type Family, type MixSettings, moodFor, pickVariant, type Surface } from './AudioMath';
import { MusicDirector } from './MusicDirector';
import { type Perch, SoundscapeDirector } from './SoundscapeDirector';

export type { V3 };

/**
 * Phase 8: the game's one sound facade. Game.ts calls the named events below (restored, bloom, build, meow…);
 * underneath, the AudioDirector owns the context, buses, limiter and voice limits, the SoundscapeDirector the
 * world's living sound, and the MusicDirector the score. docs/audio/AUDIO_EVENT_MAP.md lists every event.
 *
 * The designed (synthesised) layer is one small palette: soft felt-mallet notes on a pentatonic scale and shaped
 * noise, all low-passed. Recorded organic layers (soil, leaves, footsteps, the cat) are used where they exist.
 */
const PENTA = [0, 2, 4, 7, 9];

/** How many grown trees near the listener may host bird calls. */
export const BIRD_VOICES = 6;

/** Recorded one-shots (assets/audio/sfx/…), as variation sets. */
const SAMPLES = {
  soil: 'sfx/restoration/soil',
  leaf: 'sfx/restoration/leaf',
  meow: 'sfx/events/meow',
  step: (s: Surface) => `sfx/player/step-${s}`,
};

/** What Game tells the soundscape a few times a second. */
export interface WorldSense {
  area: AreaSound;
  daylight: number;
  wind: number;
  /** the whole world's restoration 0..1 */
  world: number;
  /** anything has been restored yet (until then the world waits in silence: no music) */
  restoredOnce: boolean;
  /** where the listener's attention is (the bot, or the view's focus), world coords */
  focus: V3;
}

export class Sfx {
  readonly director = new AudioDirector();
  readonly soundscape = new SoundscapeDirector(this.director);
  readonly music = new MusicDirector(this.director);
  /** Legacy fields Game sets every frame: layers 0..3 and the world's life 0..1. */
  layers = 0;
  life = 0;
  muted = false;
  musicOn = true;
  private sense: WorldSense = { area: { ...DEAD_AREA }, daylight: 1, wind: 0, world: 0, restoredOnce: false, focus: { x: 0, y: 0, z: 0 } };
  private noiseBuf?: AudioBuffer;
  /** Where the effect being played happens (set by at()); undefined: centred. */
  private pos?: V3;

  get ctx() {
    return this.director.ctx;
  }

  // ───────────────────────── lifecycle and mix ─────────────────────────

  unlock() {
    if (!this.director.unlock()) return;
    const ctx = this.director.ctx!;
    // one shared noise buffer: every noise voice is a slice of it (no allocation per sound)
    const n = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.soundscape.start();
    this.director.preload([...variants(SAMPLES.soil), ...variants(SAMPLES.leaf), ...variants(SAMPLES.meow), ...(['grass', 'dirt', 'stone', 'wood', 'sand', 'water'] as Surface[]).flatMap((s) => variants(SAMPLES.step(s)))]);
  }

  /** #673: after the page was hidden, picks the sound up again if the browser put it to sleep. */
  resume() {
    this.director.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.director.setMix({ sfxOn: !m });
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    this.director.setMix({ musicOn: on });
  }

  /** Volumes 0..1 from Settings (and quiet while the page is hidden, see volumesFor). */
  setVolumes(v: { sfx: number; music: number; master?: number; ambience?: number; ui?: number }) {
    const m: Partial<MixSettings> = { sfx: v.sfx, music: v.music };
    if (v.master !== undefined) m.master = v.master;
    if (v.ambience !== undefined) m.ambience = v.ambience;
    if (v.ui !== undefined) m.ui = v.ui;
    // going quiet for a hidden page is quick; coming back is a gentle fade-in
    const back = (v.master ?? 1) > (this.director.mix.master ?? 1);
    this.director.setMix(m, back ? 1.2 : 0.15);
  }

  /** The "reduced repetitive effects" setting. */
  setReduced(on: boolean) {
    this.director.voices.reduced = on;
    this.soundscape.reduced = on;
  }

  /** E23.2.3: while bloombot sits, the music swells a little (slowly, never a jump). */
  swell(by: number) {
    this.music.intensity = Math.min(1.3, this.baseIntensity() + Math.max(0, by));
  }

  private baseIntensity() {
    return 0.35 + 0.65 * Math.max(this.sense.area.life, this.sense.world);
  }

  // ───────────────────────── 3D ─────────────────────────

  setListener(p: V3, fwd: V3, up: V3) {
    this.director.setListener(p, fwd, up);
  }

  /** Plays `play` with every voice placed at `p` in the world (3D). A missing `p` plays centred. */
  at(p: V3 | null | undefined, play: (s: this) => void) {
    const prev = this.pos;
    this.pos = p ?? undefined;
    try {
      play(this);
    } finally {
      this.pos = prev;
    }
  }

  /** Trees near the listener (nearest first) where birds may call. */
  setBirds(trees: Perch[]) {
    this.soundscape.setPerches(trees);
  }

  setBrook(amount: number, x: number, y: number, z: number) {
    this.soundscape.setBrook(amount, { x, y, z });
  }

  setSea(amount: number, x: number, y: number, z: number) {
    this.soundscape.setSea(amount, { x, y, z });
  }

  /** What is around the listener (Game samples it a few times a second). */
  setSense(s: WorldSense) {
    this.sense = s;
  }

  /** Every frame (real time: the world keeps sounding through a pause). Directors re-evaluate at 4 Hz. */
  private lastTick = -1;
  update(_dt: number) {
    if (!this.director.ready) return;
    // the audio clock, not the frame's (capped) dt: on a slow frame the soundscape still glides in real seconds
    const now = this.director.now();
    if (this.lastTick < 0) this.lastTick = now;
    if (now - this.lastTick < 0.25) return;
    const step = Math.min(2, now - this.lastTick);
    this.lastTick = now;
    const s = this.sense;
    const input = { area: s.area, daylight: s.daylight, world: Math.max(s.world, this.life), wind: s.wind };
    this.soundscape.update(step, input, s.focus);
    this.director.setNight(1 - Math.min(1, s.daylight / 0.5));
    if (this.music.intensity <= 1) this.music.intensity = this.baseIntensity();
    this.music.update(step, moodFor({ ...input, area: this.soundscape.area }, s.restoredOnce));
  }

  // ───────────────────────── voices ─────────────────────────

  private busFor(fam: Family): BusId {
    return fam === 'ui' ? 'ui' : 'sfx';
  }

  /** The output for a voice: a 3D panner when at() placed it, else its bus. */
  private out(fam: Family): AudioNode | undefined {
    const bus = this.busFor(fam);
    if (this.pos && fam !== 'ui') return this.director.spatialOut(this.pos, bus, 30);
    return this.director.bus[bus];
  }

  /**
   * One designed voice: a felt-mallet note (sine with a soft inharmonic partial that dies fast) or a pad
   * (slow attack). Everything is low-passed: nothing in this game is shrill.
   */
  private tone(fam: Family, freq: number, dur: number, o: { vol?: number; type?: OscillatorType; attack?: number; glide?: number; delay?: number; mallet?: boolean; cutoff?: number } = {}) {
    const ctx = this.director.ctx;
    if (!ctx) return;
    const out = this.out(fam);
    if (!out) return;
    const lim = this.director.voices;
    lim.start(fam);
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = new OscillatorNode(ctx, { type: o.type ?? 'sine', frequency: freq });
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * o.glide), t0 + dur);
    const g = new GainNode(ctx, { gain: 0.0001 });
    const v = o.vol ?? 0.15;
    const atk = o.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: o.cutoff ?? Math.min(6000, freq * 4), Q: 0.4 });
    osc.connect(g).connect(lp).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    let partial: OscillatorNode | undefined;
    if (o.mallet) {
      // the mallet's knock: a quiet partial near 4x that decays in a few tens of ms
      partial = new OscillatorNode(ctx, { type: 'sine', frequency: freq * 3.99 });
      const pg = new GainNode(ctx, { gain: 0.0001 });
      pg.gain.setValueAtTime(0.0001, t0);
      pg.gain.exponentialRampToValueAtTime(v * 0.18, t0 + 0.003);
      pg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
      partial.connect(pg).connect(lp);
      partial.start(t0);
      partial.stop(t0 + 0.1);
    }
    osc.onended = () => {
      lim.end(fam);
      lp.disconnect();
      if (out instanceof PannerNode) out.disconnect();
    };
  }

  /** Shaped noise: a band that moves from `f0` to `f1` (Hz) over `dur`, with a soft attack. */
  private hiss(fam: Family, dur: number, vol: number, f0: number, f1 = f0, o: { attack?: number; delay?: number; q?: number } = {}) {
    const ctx = this.director.ctx;
    const buf = this.noiseBuf;
    if (!ctx || !buf) return;
    const out = this.out(fam);
    if (!out) return;
    const lim = this.director.voices;
    lim.start(fam);
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = new AudioBufferSourceNode(ctx, { buffer: buf });
    const f = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: f0, Q: o.q ?? 0.9 });
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    const g = new GainNode(ctx, { gain: 0.0001 });
    const atk = o.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
    src.onended = () => {
      lim.end(fam);
      g.disconnect();
      if (out instanceof PannerNode) out.disconnect();
    };
  }

  /** A recorded sample from a variation set (no repeats in a row, small pitch/level variation). False if none. */
  private lastVar: Record<string, number> = {};
  private sample(base: string, fam: Family, vol: number, o: { spread?: number; delay?: number } = {}): boolean {
    const ids = variants(base);
    if (!ids.length) return false;
    const i = pickVariant(ids.length, this.lastVar[base] ?? -1);
    const spread = o.spread ?? 0.06;
    const ok = this.director.play(ids[i], { bus: this.busFor(fam), fam, vol: vol * (0.88 + Math.random() * 0.24), rate: 1 - spread + Math.random() * spread * 2, pos: this.pos, ref: 30, delay: o.delay });
    if (ok) this.lastVar[base] = i;
    return ok;
  }

  /** Admits an event of `fam` now (cooldown and caps). */
  private admit(fam: Family, key?: string, keyGap = 0) {
    return !!this.director.ctx && this.director.voices.admit(fam, this.director.now(), 1, key, keyGap);
  }

  note(step: number, base = 392) {
    const oct = Math.floor(step / 5);
    const semis = PENTA[((step % 5) + 5) % 5] + oct * 12;
    return base * Math.pow(2, semis / 12);
  }

  // ───────────────────────── restoration (the signature moment) ─────────────────────────

  /** 1. Action: bloombot's pulse: a soft, textured intake of energy (a breathy whoosh rising). */
  pulse() {
    if (!this.admit('restore', 'pulse', 0.12)) return;
    this.hiss('restore', 0.42, 0.11, 380, 1500, { attack: 0.16, q: 0.7 });
    this.tone('restore', 196, 0.38, { vol: 0.05, glide: 1.5, attack: 0.12, type: 'triangle', cutoff: 900 });
  }

  /**
   * 2. Transformation: soil relaxing and leaves unfolding, with a warm mallet note that climbs the scale as you
   * restore tile after tile. (3. Life returning is the soundscape: the patch's own leaves and, later, birds.)
   */
  restored(n = 0) {
    if (!this.admit('restore', 'restored', 0.06)) return;
    if (!this.sample(SAMPLES.soil, 'restore', 0.5)) this.hiss('restore', 0.22, 0.07, 260, 160, { attack: 0.01, q: 0.6 });
    if (!this.sample(SAMPLES.leaf, 'restore', 0.35, { delay: 0.05 })) this.hiss('restore', 0.35, 0.035, 2200, 3200, { attack: 0.08, delay: 0.05 });
    this.tone('restore', this.note(n % 7), 0.7, { vol: 0.11, mallet: true, delay: 0.06 });
    this.tone('restore', this.note((n % 7) + 2), 0.6, { vol: 0.05, mallet: true, delay: 0.13 });
  }

  /** A tile grows a stage (grass → flowers → shrubs): a leafy unfolding and a two-note rise, warmer each level. */
  nurture(level: number) {
    if (!this.admit('restore', 'nurture', 0.08)) return;
    if (!this.sample(SAMPLES.leaf, 'restore', 0.3 + 0.1 * level)) this.hiss('restore', 0.4, 0.04, 1800, 2600, { attack: 0.1 });
    this.tone('restore', this.note(level * 2), 0.6, { vol: 0.1, mallet: true });
    this.tone('restore', this.note(level * 2 + 2), 0.7, { vol: 0.07, mallet: true, delay: 0.09 });
  }

  // ───────────────────────── Bloom Chains ─────────────────────────

  private chainTimes: number[] = [];
  /**
   * One bloom of a chain. Aggregated: a capped family, a rising pentatonic ladder that never leaves two octaves,
   * fuller chords as it grows, softer as blooms come faster (chainTone). 50 blooms are a texture, not 50 pings.
   */
  bloom(combo: number) {
    const now = this.director.now();
    this.chainTimes = this.chainTimes.filter((t) => now - t < 1);
    this.chainTimes.push(now);
    const gap = combo < 20 ? 0.07 : combo < 100 ? 0.12 : 0.2;
    if (!this.admit('chain', 'bloom', gap)) return;
    const c = chainTone(combo, this.chainTimes.length);
    for (let i = 0; i < c.voices; i++) this.tone('chain', this.note(c.step + i * 2), 0.55, { vol: c.vol, mallet: i === 0, delay: i * 0.025, cutoff: 2200 + 2000 * c.bright });
    if (combo % 4 === 0) this.hiss('chain', 0.3, 0.02 + 0.02 * c.bright, 2600, 3600, { attack: 0.06 });
  }

  /** A chain's landing: a resolved chord, fuller for longer chains; a long chain briefly widens and ducks the music. */
  chainEnd(combo: number) {
    if (!this.admit('event', 'chainEnd', 0.5)) return;
    const n = combo >= 10 ? 5 : combo >= 5 ? 4 : 3;
    for (let i = 0; i < n; i++) this.tone('event', this.note(i * 2 + 2), 1.1, { vol: 0.1, mallet: true, delay: i * 0.09 });
    if (combo >= 10) {
      this.tone('event', this.note(0, 196), 2.2, { vol: 0.07, attack: 0.4, type: 'triangle', cutoff: 1200, delay: 0.2 });
      this.hiss('event', 1.6, 0.04, 900, 3000, { attack: 0.5 });
      const d = duckFor(Math.min(1, combo / 40));
      this.director.duck(d.db, d.hold);
    }
  }

  // ───────────────────────── building and economy ─────────────────────────

  /** Place a machine: a wooden knock, a little latch, and a settling chord (no square-wave beeps). */
  build() {
    if (!this.admit('build', 'build', 0.08)) return;
    this.tone('build', 150, 0.22, { vol: 0.22, glide: 0.6, cutoff: 700 });
    this.hiss('build', 0.06, 0.08, 1800, 1200, { attack: 0.002, q: 2, delay: 0.1 });
    this.tone('build', this.note(4), 0.5, { vol: 0.08, mallet: true, delay: 0.16 });
    this.tone('build', this.note(7), 0.6, { vol: 0.06, mallet: true, delay: 0.24 });
  }

  /** A machine wakes: a soft rising hum into a bright note. */
  powerUp() {
    if (!this.admit('build', 'power', 0.3)) return;
    this.tone('build', 220, 0.5, { glide: 2, vol: 0.06, attack: 0.15, type: 'triangle', cutoff: 1400 });
    this.tone('build', this.note(7), 0.7, { vol: 0.08, mallet: true, delay: 0.32 });
  }

  /** Spend / upgrade / deliver: a clear, ascending two-note confirmation. Repeats soften into a quiet patter. */
  private coinAt = -9;
  coin() {
    const now = this.director.now();
    const quick = now - this.coinAt < 0.6;
    this.coinAt = now;
    if (!this.admit('economy')) return;
    const v = quick ? 0.05 : 0.09;
    this.tone('economy', this.note(7), 0.35, { vol: v, mallet: true });
    this.tone('economy', this.note(9), 0.5, { vol: v, mallet: true, delay: 0.07 });
  }

  // ───────────────────────── interface ─────────────────────────

  error() {
    if (!this.admit('ui', 'error', 0.25)) return;
    this.tone('ui', 247, 0.18, { vol: 0.12, mallet: true });
    this.tone('ui', 196, 0.26, { vol: 0.1, mallet: true, delay: 0.09 });
  }

  click() {
    if (!this.admit('ui', 'click', 0.035)) return;
    this.tone('ui', 1047, 0.06, { vol: 0.08, mallet: true, cutoff: 3000 });
  }

  // ───────────────────────── milestones ─────────────────────────

  /** A goal done (the waymark's Bloom Pulse): a soft swell and a rising chord with a little shimmer. */
  bloomPulse() {
    if (!this.admit('event', 'bloomPulse', 1)) return;
    this.hiss('event', 1.2, 0.035, 600, 2400, { attack: 0.4 });
    [0, 2, 4, 7].forEach((st, i) => this.tone('event', this.note(st), 1.2 - i * 0.1, { vol: 0.09, mallet: true, delay: 0.1 + i * 0.08 }));
    this.tone('event', this.note(9) * 2, 1.2, { vol: 0.025, delay: 0.45, cutoff: 3500 });
    this.director.duck(-1.5, 1.5);
  }

  /** A new area opens: a lighter, airy cue (not the landmark's). */
  areaOpen() {
    if (!this.admit('event', 'areaOpen', 2)) return;
    this.hiss('event', 1.8, 0.035, 400, 1800, { attack: 0.7 });
    [0, 4, 7].forEach((st, i) => this.tone('event', this.note(st, 294), 1.6, { vol: 0.08, mallet: true, delay: 0.3 + i * 0.16 }));
    this.director.duck(-1.5, 2);
  }

  /**
   * A landmark wakes, a fountain tier, the core: the rare big moment. A warm pad chord swells under a rising
   * mallet phrase, the music dips by a few dB and recovers. Distinct from every routine sound.
   */
  landmark() {
    if (!this.admit('event', 'landmark', 3)) return;
    const root = 196;
    for (const st of [0, 4, 7]) this.tone('event', this.note(st, root), 3.6, { vol: 0.06, attack: 0.9, type: 'triangle', cutoff: 1400 });
    this.tone('event', root / 2, 3.8, { vol: 0.07, attack: 0.8, cutoff: 500 });
    [0, 2, 4, 7, 9, 12].forEach((st, i) => this.tone('event', this.note(st), 1.4, { vol: 0.09, mallet: true, delay: 0.45 + i * 0.14 }));
    this.tone('event', this.note(14), 2.4, { vol: 0.07, mallet: true, delay: 1.4 });
    this.hiss('event', 3, 0.03, 500, 3200, { attack: 1.2 });
    const d = duckFor(1);
    this.director.duck(d.db, d.hold);
  }

  /** Legacy name: every old fanfare is a landmark-sized moment. */
  fanfare() {
    this.landmark();
  }

  // ───────────────────────── the Lucky Cat ─────────────────────────

  /** A cat's meow: recorded if we have one, else a soft designed one. `quiet`: a far-off hint. */
  meow(quiet = false) {
    if (!this.admit('cat', quiet ? 'meowHint' : 'meow', 0.5)) return;
    if (this.sample(SAMPLES.meow, 'cat', quiet ? 0.25 : 0.7, { spread: 0.05 })) return;
    const v = quiet ? 0.03 : 0.08;
    this.tone('cat', 700, 0.2, { type: 'triangle', vol: v * 0.6, glide: 1.25, attack: 0.04, cutoff: 2500 });
    this.tone('cat', 880, 0.38, { type: 'triangle', vol: v, glide: 0.66, attack: 0.03, delay: 0.12, cutoff: 2500 });
  }

  /**
   * Found a Lucky Cat: the meow, then a playful skipping run up the scale and back. A golden cat adds a bright
   * upper octave; a rainbow (jackpot) cat finishes with a shimmering chord.
   */
  catFound(variant: 'plain' | 'golden' | 'rainbow' = 'plain') {
    this.meow();
    if (!this.admit('event', 'catFound', 1)) return;
    const run = [0, 2, 4, 2, 4, 7];
    run.forEach((st, i) => this.tone('event', this.note(st + 5), 0.4, { vol: 0.08, mallet: true, delay: 0.35 + i * 0.075 }));
    if (variant !== 'plain') [7, 9, 12].forEach((st, i) => this.tone('event', this.note(st + 5), 0.8, { vol: 0.06, mallet: true, delay: 0.85 + i * 0.09 }));
    if (variant === 'rainbow') {
      for (const st of [5, 9, 12]) this.tone('event', this.note(st), 2.4, { vol: 0.05, attack: 0.5, type: 'triangle', delay: 1.1, cutoff: 2000 });
      this.hiss('event', 2, 0.03, 2000, 4000, { attack: 0.6, delay: 1 });
      this.director.duck(-2.5, 2.5);
    } else this.director.duck(-1.5, 1.6);
  }

  // ───────────────────────── drones and machines ─────────────────────────

  /** A drone sets off on a job: each role a quiet chirp of its own, at most one per role every 0.4 s. */
  drone(role: 'restorer' | 'gardener' | 'scout' | 'courier' | 'spark' | 'harvester' = 'restorer') {
    if (!this.admit('drone', `drone:${role}`, 0.4)) return;
    switch (role) {
      case 'gardener':
        return this.tone('drone', 520, 0.16, { vol: 0.04, glide: 0.8 });
      case 'scout':
        return this.tone('drone', 880, 0.1, { vol: 0.03, glide: 1.4, cutoff: 2500 });
      case 'courier':
        this.tone('drone', 392, 0.1, { vol: 0.035, mallet: true });
        return this.tone('drone', 523, 0.1, { vol: 0.03, mallet: true, delay: 0.07 });
      case 'spark':
        return this.tone('drone', 1175, 0.08, { vol: 0.025, glide: 0.6, type: 'triangle', cutoff: 2500 });
      default:
        return this.tone('drone', 587, 0.14, { vol: 0.04, glide: 1.4, type: 'triangle', cutoff: 2000 });
    }
  }

  /** One sound per stage of a living transition, rate-limited per stage (a big chain is a texture, not a wall). */
  stage(kind: 'crack' | 'grind' | 'creak' | 'thud' | 'sprout' | 'rustle' | 'hum') {
    const gap = kind === 'hum' ? 1.2 : kind === 'crack' ? 0.08 : 0.18;
    if (!this.admit('stage', `stage:${kind}`, gap)) return;
    switch (kind) {
      case 'crack':
        return this.hiss('stage', 0.07, 0.09, 2400, 1600, { attack: 0.002, q: 1.4 });
      case 'grind':
        return this.hiss('stage', 0.3, 0.06, 300, 200, { attack: 0.03, q: 0.6 });
      case 'creak':
        return this.tone('stage', 130 + Math.random() * 40, 0.34, { vol: 0.04, type: 'triangle', glide: 1.4, attack: 0.08, cutoff: 600 });
      case 'thud':
        if (!this.sample(SAMPLES.soil, 'stage', 0.35)) this.tone('stage', 95, 0.18, { vol: 0.12, glide: 0.55, cutoff: 400 });
        return;
      case 'sprout':
        return this.tone('stage', 700 + Math.random() * 160, 0.12, { vol: 0.045, glide: 1.4, cutoff: 1800 });
      case 'rustle':
        if (!this.sample(SAMPLES.leaf, 'stage', 0.25)) this.hiss('stage', 0.34, 0.03, 1700, 2400, { attack: 0.05 });
        return;
      case 'hum':
        // the Cultivator: a low, soft, proximity-bound hum (it is placed in 3D by at())
        this.tone('stage', 110, 1, { vol: 0.03, attack: 0.25, cutoff: 300 });
        return this.tone('stage', 330, 0.6, { vol: 0.01, attack: 0.15, glide: 1.05, delay: 0.1, cutoff: 700 });
    }
  }

  // ───────────────────────── footsteps ─────────────────────────

  /**
   * One footfall on `surface` at `p`. Recorded steps when the set exists; else a designed soft step. Quiet, and
   * capped at two voices so a sprint never chatters.
   */
  footstep(surface: Surface, p: V3, pace = 1) {
    if (!this.director.ctx) return;
    const prev = this.pos;
    this.pos = p;
    try {
      const vol = 0.32 * Math.min(1.2, 0.7 + 0.3 * pace);
      if (this.sample(SAMPLES.step(surface), 'footstep', vol, { spread: 0.08 })) return;
      if (!this.admit('footstep')) return;
      switch (surface) {
        case 'grass':
          return this.hiss('footstep', 0.12, 0.05, 2600, 1800, { attack: 0.01, q: 0.6 });
        case 'dirt':
          this.hiss('footstep', 0.09, 0.06, 900, 600, { attack: 0.004, q: 0.8 });
          return this.tone('footstep', 80, 0.07, { vol: 0.06, cutoff: 300 });
        case 'sand':
          return this.hiss('footstep', 0.16, 0.05, 1300, 900, { attack: 0.02, q: 0.5 });
        case 'stone':
          this.hiss('footstep', 0.04, 0.06, 2800, 2200, { attack: 0.002, q: 1.6 });
          return this.tone('footstep', 140, 0.06, { vol: 0.07, cutoff: 500 });
        case 'wood':
          this.tone('footstep', 210, 0.1, { vol: 0.09, mallet: true, cutoff: 900 });
          return this.hiss('footstep', 0.05, 0.03, 1200, 900, { attack: 0.002, q: 1.2 });
        case 'water':
          return this.hiss('footstep', 0.22, 0.06, 1500, 700, { attack: 0.01, q: 0.5 });
      }
    } finally {
      this.pos = prev;
    }
  }

  // ───────────────────────── debug ─────────────────────────

  /** A snapshot for the audio debug HUD. */
  debug() {
    const sc = this.soundscape;
    return {
      ...this.director.stats(),
      stage: sc.stage,
      area: sc.area,
      beds: sc.levels,
      brook: sc.brookLevel,
      sea: sc.seaLevel,
      music: this.music.status,
      intensity: this.music.intensity,
      ducking: this.director.ducking,
      wildlife: sc.log,
      restoredOnce: this.sense.restoredOnce,
    };
  }
}

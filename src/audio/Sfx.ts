import { bloomVoice } from '../ui/ChainSummary';
/**
 * Synthesised sound effects plus streamed music and atmos beds. Voice-capped; silent until the first user gesture.
 * Tracks are CC0 (see CREDITS.md in assets/raw/audio/music and assets/raw/audio/atmos).
 */
const PENTA = [0, 2, 4, 7, 9];

const AUDIO_DIR = '../../assets/raw/audio/';
/** Only the files named here are bundled; the other raw tracks wait for later layers. */
const TRACK_URLS = import.meta.glob(
  [
    '../../assets/raw/audio/music/birds-wind-synth-v2.ogg',
    '../../assets/raw/audio/music/birds-wind-ambient.ogg',
    '../../assets/raw/audio/music/kalimba-think-id-stay-clean.ogg',
    '../../assets/raw/audio/atmos/city-wind.ogg',
    '../../assets/raw/audio/atmos/city-hum.ogg',
    '../../assets/raw/audio/atmos/water-flowing.ogg',
    '../../assets/raw/audio/atmos/crickets.mp3',
    '../../assets/raw/audio/atmos/brook.wav',
    '../../assets/raw/audio/atmos/birds-trees.wav',
  ],
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;

export type V3 = { x: number; y: number; z: number };

/** Every 3D source uses this distance model: full level within `refDistance` of the camera, softer beyond. */
const SPATIAL: PannerOptions = { panningModel: 'HRTF', distanceModel: 'inverse', rolloffFactor: 1, maxDistance: 300 };
/** Effects keep their level at normal viewing distance; ambient objects (brook, birds) swell as you zoom in. */
const FX_REF = 30;
const AMBIENT_REF = 14;
/** Bird emitters in the trees nearest the view. */
export const BIRD_VOICES = 3;

/** 0 below `a`, 1 above `b`, smooth in between. */
const ramp = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Looping beds, each mixed by how alive the world is (`life`, 0..1). `bus` 'music' follows the Music setting;
 * 'atmos' is the world's own sound and follows the Sound setting. New layers go here: a file, a bus, a level
 * curve. Atmos levels also even out the raw files' loudness (wind is loud, crickets very quiet).
 */
export const AUDIO_BEDS: { file: string; bus: 'music' | 'atmos'; level: (life: number) => number; spatial?: 'brook' | 'sea' }[] = [
  // E21.12: the Old City's sea, a 3D wash placed at the nearest shore (level and position from setSea). Running
  // water stands in for surf until a surf recording is added.
  { file: 'atmos/water-flowing.ogg', bus: 'atmos', level: () => 0, spatial: 'sea' },
  // 3D: a babbling brook placed at the clean water nearest the view (level and position from setBrook).
  { file: 'atmos/brook.wav', bus: 'atmos', level: () => 0, spatial: 'brook' },
  // The synth-and-birds score: the atmospheric bed under the melody.
  { file: 'music/birds-wind-synth-v2.ogg', bus: 'music', level: (life) => 0.6 + 0.2 * life },
  // The kalimba melody (the tune): present from the start, warmer and fuller as the garden grows.
  { file: 'music/kalimba-think-id-stay-clean.ogg', bus: 'music', level: (life) => 0.55 + 0.45 * life },
  // Birdsong and wind: silent in the grey city, rising as wildlife comes back.
  { file: 'music/birds-wind-ambient.ogg', bus: 'music', level: (life) => 1.1 * ramp(life, 0.05, 0.8) },
  // Dead city: hollow wind and a low hum, receding as the park comes alive (a breath of wind always stays).
  { file: 'atmos/city-wind.ogg', bus: 'atmos', level: (life) => 0.056 * (1 - 0.8 * ramp(life, 0, 0.6)) },
  { file: 'atmos/city-hum.ogg', bus: 'atmos', level: (life) => 0.4 * (1 - ramp(life, 0, 0.5)) },
  // Living park: running water, then insects once the garden is well along.
  { file: 'atmos/water-flowing.ogg', bus: 'atmos', level: (life) => 0.9 * ramp(life, 0.15, 0.7) },
  { file: 'atmos/crickets.mp3', bus: 'atmos', level: (life) => 5.2 * ramp(life, 0.35, 1) },
];

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
  /** Phase 4 E06: while Bloom Frenzy runs, the pad plays faster and fuller. */
  frenzy = false;
  /** 0..1, how restored and alive the world is; mixes the wildlife beds in. */
  life = 0;
  private beds: { el: HTMLAudioElement; gain: GainNode; bus: 'music' | 'atmos'; level: (life: number) => number; at: number }[] = [];
  /** The brook's 3D emitter (HRTF), and how much clean water is near the view (0..1). */
  private brookPanner?: PannerNode;
  private brookLevel = 0;
  /** E21.12: the sea's 3D emitter and level (0 away from the Old City's shore) */
  private seaPanner?: PannerNode;
  private seaLevel = 0;

  /**
   * 3D object audio (the web's take on what Atmos does over headphones): the listener sits at the camera, looking
   * where it looks; spatial sounds are rendered binaurally with HRTF. Call every frame with world coordinates.
   */
  setListener(p: { x: number; y: number; z: number }, fwd: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** Where the effect being played happens (set by at()); undefined: an interface sound, centred in the head. */
  private pos?: V3;

  /**
   * Plays `play` with every voice it makes placed at `p` in the world, rendered in 3D (HRTF). World sounds (tile
   * restores, cracks, blooms, builds, drones, the cat) go through here; interface sounds (clicks, errors, coin and
   * fanfare stingers) are called directly and stay centred. A missing `p` plays centred too.
   */
  at(p: V3 | null | undefined, play: (s: this) => void) {
    const prev = this.pos;
    this.pos = p ?? undefined;
    try {
      play(this);
    } finally {
      this.pos = prev;
    }
  }

  /** A voice's output: its own HRTF panner at `pos` for a world sound, else straight to the effects bus. */
  private voiceOut(): AudioNode {
    const bus = this.sfxGain ?? this.master!;
    if (!this.pos || !this.ctx) return bus;
    const p = new PannerNode(this.ctx, { ...SPATIAL, refDistance: FX_REF, positionX: this.pos.x, positionY: this.pos.y, positionZ: this.pos.z });
    p.connect(bus);
    return p;
  }

  /** Birds in the trees: looping voices of one recording, each with its own panner, gain and start offset. */
  private birds: { gain: GainNode; panner: PannerNode; at: number }[] = [];

  /** Decodes the birds loop once and starts BIRD_VOICES silent emitters (setBirds moves and fades them). */
  private async startBirds() {
    const ctx = this.ctx;
    const url = TRACK_URLS[AUDIO_DIR + 'atmos/birds-trees.wav'];
    if (!ctx || !this.sfxGain || !url) return;
    try {
      const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
      for (let i = 0; i < BIRD_VOICES; i++) {
        const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
        const gain = new GainNode(ctx, { gain: 0 });
        const panner = new PannerNode(ctx, { ...SPATIAL, refDistance: AMBIENT_REF });
        src.connect(gain).connect(panner).connect(this.sfxGain);
        // Offset each voice through the loop, so three trees never sing the same phrase together.
        src.start(0, (buf.duration * i) / BIRD_VOICES);
        this.birds.push({ gain, panner, at: 0 });
      }
    } catch {
      /* no birds: the rest of the soundscape carries on */
    }
  }

  /**
   * Puts the bird voices in these trees (nearest first, up to BIRD_VOICES), `amount` 0..1 each by how grown the
   * tree is. Voices without a tree fade out where they are.
   */
  setBirds(trees: (V3 & { amount: number })[]) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.birds.forEach((v, i) => {
      const tree = trees[i];
      const level = tree ? 0.35 * Math.max(0, Math.min(1, tree.amount)) : 0;
      if (tree) {
        // A silent voice jumps straight to its new tree; a singing one glides there.
        const glide = v.at < 0.01 ? 0.01 : 0.6;
        v.panner.positionX.setTargetAtTime(tree.x, t, glide);
        v.panner.positionY.setTargetAtTime(tree.y, t, glide);
        v.panner.positionZ.setTargetAtTime(tree.z, t, glide);
      }
      if (Math.abs(level - v.at) > 0.005) v.gain.gain.setTargetAtTime(level, t, 1.2);
      v.at = level;
    });
  }

  /** Places the brook at (x, y, z) with `amount` 0..1 of nearby clean water (0 fades it out). */
  setBrook(amount: number, x: number, y: number, z: number) {
    this.brookLevel = 0.3 * Math.max(0, Math.min(1, amount));
    const p = this.brookPanner;
    if (!p || !this.ctx || amount <= 0) return;
    const t = this.ctx.currentTime;
    p.positionX.setTargetAtTime(x, t, 0.3);
    p.positionY.setTargetAtTime(y, t, 0.3);
    p.positionZ.setTargetAtTime(z, t, 0.3);
  }

  /** E21.12: places the sea's wash at (x, y, z) with `amount` 0..1 (0 fades it out). */
  setSea(amount: number, x: number, y: number, z: number) {
    this.seaLevel = 0.45 * Math.max(0, Math.min(1, amount));
    const p = this.seaPanner;
    if (!p || !this.ctx || amount <= 0) return;
    const t = this.ctx.currentTime;
    p.positionX.setTargetAtTime(x, t, 0.3);
    p.positionY.setTargetAtTime(y, t, 0.3);
    p.positionZ.setTargetAtTime(z, t, 0.3);
  }

  /** Starts every bed fading in to its level; update() follows `life` from there. */
  private startBeds() {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || !this.sfxGain || typeof Audio === 'undefined') return;
    for (const b of AUDIO_BEDS) {
      const url = TRACK_URLS[AUDIO_DIR + b.file];
      if (!url) continue;
      try {
        const el = new Audio(url);
        el.loop = true;
        el.preload = 'auto';
        const gain = ctx.createGain();
        // Fade in to the current level now, so music never waits on the frame loop to become audible.
        const level = b.spatial === 'brook' ? () => this.brookLevel : b.spatial === 'sea' ? () => this.seaLevel : b.level;
        const at = level(this.life);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.setTargetAtTime(at, ctx.currentTime, 1.5);
        const out = b.bus === 'music' ? this.musicGain : this.sfxGain;
        const src = ctx.createMediaElementSource(el).connect(gain);
        if (b.spatial) {
          // Inverse distance from the camera: zooming in on the water brings the brook up close.
          const p = new PannerNode(ctx, { ...SPATIAL, refDistance: AMBIENT_REF });
          src.connect(p).connect(out);
          if (b.spatial === 'sea') this.seaPanner = p;
          else this.brookPanner = p;
        } else src.connect(out);
        this.beds.push({ el, gain, bus: b.bus, level, at });
      } catch {
        /* a bed that cannot play is skipped; the synth pad covers for missing music */
      }
    }
    this.playBeds('music', this.music);
    this.playBeds('atmos', !this.muted);
  }

  /** Beds whose bus is switched off are paused, not just silenced. */
  private playBeds(bus: 'music' | 'atmos', on: boolean) {
    for (const b of this.beds) {
      if (b.bus !== bus) continue;
      if (on) void b.el.play().catch(() => {});
      else b.el.pause();
    }
  }

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
    this.startBeds();
    void this.startBirds();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.sfxGain && this.ctx) this.sfxGain.gain.setTargetAtTime(m ? 0 : this.sfxVolume, this.ctx.currentTime, 0.05);
    this.playBeds('atmos', !m);
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
    this.playBeds('music', on);
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
    const out = opts.dest ?? this.voiceOut();
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    o.onended = () => {
      this.voices--;
      if (out instanceof PannerNode) out.disconnect();
    };
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
    const out = this.voiceOut();
    src.connect(f).connect(g).connect(out);
    src.start();
    src.onended = () => {
      this.voices--;
      if (out instanceof PannerNode) out.disconnect();
    };
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
  /**
   * A drone sets off on a job. E18.5: each role has its own pitch and timbre (Restorer as before), and a role's
   * chirp plays at most every 80 ms, so a busy swarm never becomes a constant overlapping beep.
   */
  private droneAt: Record<string, number> = {};
  drone(role: 'restorer' | 'gardener' | 'scout' | 'courier' | 'spark' | 'harvester' = 'restorer') {
    const now = performance.now() / 1000;
    if (now - (this.droneAt[role] ?? -9) < 0.08) return;
    this.droneAt[role] = now;
    switch (role) {
      case 'gardener': // a soft watery blip
        return this.tone(520, 0.14, { vol: 0.035, glide: 0.8, type: 'sine' });
      case 'scout': // a higher, quicker ping
        return this.tone(990, 0.08, { vol: 0.03, glide: 1.8, type: 'triangle' });
      case 'courier': // a low two-step hum
        this.tone(392, 0.09, { vol: 0.035, type: 'square' });
        return this.tone(523, 0.09, { vol: 0.03, type: 'square', delay: 0.07 });
      case 'spark': // a bright zap
        return this.tone(1320, 0.07, { vol: 0.03, glide: 0.5, type: 'sawtooth' });
      default:
        return this.tone(660, 0.12, { vol: 0.04, glide: 1.5, type: 'triangle' });
    }
  }

  /**
   * Look 6.10: one sound per stage of a living transition, layered across tiles but rate-limited per stage, so
   * a big chain is a texture of cracks and pops rather than a wall of noise.
   */
  private stageAt: Record<string, number> = {};
  stage(kind: 'crack' | 'grind' | 'creak' | 'thud' | 'sprout' | 'rustle' | 'hum') {
    const now = performance.now() / 1000;
    const gap = kind === 'hum' ? 0.9 : kind === 'crack' ? 0.07 : 0.16;
    if (now - (this.stageAt[kind] ?? -9) < gap) return;
    this.stageAt[kind] = now;
    switch (kind) {
      case 'crack': // stone crack and snap
        this.noise(0.07, 0.1, 2600);
        this.tone(1900 + Math.random() * 600, 0.04, { vol: 0.04, type: 'square', glide: 0.5 });
        break;
      case 'grind': // grinding, crumbling
        this.noise(0.28, 0.07, 260);
        break;
      case 'creak': // root creak
        this.tone(120 + Math.random() * 40, 0.32, { vol: 0.05, type: 'sawtooth', glide: 1.45, attack: 0.06 });
        break;
      case 'thud': // soft soil thud
        this.tone(95, 0.16, { vol: 0.12, glide: 0.55 });
        break;
      case 'sprout': // sprout pop
        this.tone(760 + Math.random() * 200, 0.08, { vol: 0.06, glide: 1.6 });
        break;
      case 'rustle': // turf rustle
        this.noise(0.32, 0.035, 1700);
        break;
      case 'hum': // the Cultivator's hum and tine whirr
        this.tone(110, 0.8, { vol: 0.025, type: 'sawtooth', attack: 0.2 });
        this.tone(440, 0.5, { vol: 0.012, type: 'triangle', glide: 1.1, delay: 0.1 });
        break;
    }
  }

  /**
   * Music and atmos beds fade toward their level for the current `life`. The generative pad now plays only during
   * Bloom Frenzy (its faster, fuller pulse marks the event), or always if no music bed could load.
   */
  update(dt: number) {
    if (!this.ctx || !this.musicGain) return;
    for (const b of this.beds) {
      const v = b.level(this.life);
      // Relative step, so very quiet beds (the wind) still follow small changes.
      if (Math.abs(v - b.at) <= 0.02 * Math.max(v, b.at)) continue;
      b.at = v;
      b.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 2.5);
    }
    if (!this.music) return;
    if (this.beds.some((b) => b.bus === 'music') && !this.frenzy) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = this.frenzy ? 1.2 : 2.4; // Phase 4 E06: Bloom Frenzy doubles the music's pace
    const roots = [0, 3, 1, 4];
    const r = roots[this.bar++ % roots.length];
    const base = 196;
    for (const s of [r, r + 2, r + 4]) this.tone(this.note(s, base), 2.6, { vol: 0.08, attack: 0.6, dest: this.musicGain });
    if (this.layers >= 1) this.tone(this.note(r + 5 + (this.bar % 3), base * 2), 1.2, { vol: 0.05, attack: 0.05, delay: 0.6, dest: this.musicGain, type: 'triangle' });
    if (this.layers >= 2) this.tone(this.note(r + 7, base * 2), 0.9, { vol: 0.04, delay: 1.5, dest: this.musicGain, type: 'triangle' });
    if (this.layers >= 3) this.tone(this.note(r, base / 2), 2.4, { vol: 0.07, attack: 0.3, dest: this.musicGain });
  }
}

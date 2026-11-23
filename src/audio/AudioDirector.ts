import { audioUrl } from './AudioAssets';
import { type BusId, busGains, dbToGain, type Family, gainToDb, type MixSettings, VoiceLimiter } from './AudioMath';

export type V3 = { x: number; y: number; z: number };

/** Every 3D source uses this distance model: full level within `refDistance` of the listener, softer beyond. */
export const SPATIAL: PannerOptions = { panningModel: 'HRTF', distanceModel: 'inverse', rolloffFactor: 1, maxDistance: 300 };

/** A looping bed: gapless (an AudioBuffer loop, never an <audio> element) with its own gain and optional panner. */
export interface LoopVoice {
  id: string;
  bus: BusId;
  gain: GainNode;
  panner?: PannerNode;
  /** the level it is heading to */
  level: number;
  /** the buffer arrived and it is playing */
  playing: boolean;
  /** ease to `v` with time constant `tau` seconds */
  setLevel(v: number, tau?: number): void;
  /** glide the panner (if any) to p */
  moveTo(p: V3, tau?: number): void;
}

/**
 * Phase 8 A02: the one owner of the AudioContext and the mix. Signal flow:
 *
 *   music voices → duck → nightFilter → music bus ┐
 *   ambience beds and 3D water          → ambience ├→ master → limiter → speakers
 *   gameplay effects (3D)               → sfx      │
 *   interface sounds (centred)          → ui       ┘
 *
 * The limiter is a fast compressor just under full scale, so stacked rewards never clip. Nothing makes a sound
 * before the first user gesture (unlock()).
 */
export class AudioDirector {
  ctx?: AudioContext;
  private masterGain?: GainNode;
  private limiterNode?: DynamicsCompressorNode;
  readonly bus: Partial<Record<BusId, GainNode>> = {};
  /** the music's own duck (big moments) and night softening, before its bus */
  private duckGain?: GainNode;
  private nightFilter?: BiquadFilterNode;
  readonly voices = new VoiceLimiter();
  private buffers = new Map<string, Promise<AudioBuffer | undefined>>();
  private loaded = new Set<string>();
  readonly loops: LoopVoice[] = [];
  mix: MixSettings = { master: 1, music: 1, ambience: 1, sfx: 1, ui: 1, sfxOn: true, musicOn: true };
  /** the fade a mix change takes (seconds); a tab returning fades back in gently */
  fade = 0.08;
  /** missing or undecodable files (the debug HUD lists them) */
  readonly missing = new Set<string>();

  get ready() {
    return !!this.ctx;
  }

  /** Creates the context on the first gesture (browser autoplay rules); later calls only wake it. */
  unlock(): boolean {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return false;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -4;
      lim.knee.value = 3;
      lim.ratio.value = 20;
      lim.attack.value = 0.003;
      lim.release.value = 0.25;
      lim.connect(ctx.destination);
      this.limiterNode = lim;
      // a meter after the limiter (what the speakers get): the debug HUD and the audio e2e test read it
      this.meter = new AnalyserNode(ctx, { fftSize: 4096, smoothingTimeConstant: 0 });
      lim.connect(this.meter);
      // -1 dBFS ceiling after the limiter's make-up (it has none: threshold -4 leaves the headroom)
      this.masterGain = new GainNode(ctx, { gain: 1 });
      this.masterGain.connect(lim);
      const g = busGains(this.mix);
      for (const b of ['music', 'ambience', 'sfx', 'ui'] as BusId[]) {
        const n = new GainNode(ctx, { gain: 0 });
        n.gain.setTargetAtTime(g[b], ctx.currentTime, 1.2); // everything fades in on unlock: never a jolt
        n.connect(this.masterGain);
        this.bus[b] = n;
      }
      this.nightFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 16000, Q: 0.5 });
      this.duckGain = new GainNode(ctx, { gain: 1 });
      this.duckGain.connect(this.nightFilter).connect(this.bus.music!);
    } catch {
      this.ctx = undefined;
      return false;
    }
    return true;
  }

  /** After the page was hidden: wake a context the browser put to sleep (no new context). */
  resume() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume().catch(() => {});
  }

  now() {
    return this.ctx?.currentTime ?? performance.now() / 1000;
  }

  /** Where music voices connect (through the duck and the night filter). */
  musicIn(): AudioNode | undefined {
    return this.duckGain;
  }

  setMix(m: Partial<MixSettings>, fade = this.fade) {
    this.mix = { ...this.mix, ...m };
    const ctx = this.ctx;
    if (!ctx) return;
    const g = busGains(this.mix);
    for (const b of Object.keys(g) as BusId[]) this.bus[b]?.gain.setTargetAtTime(g[b], ctx.currentTime, fade);
  }

  /** Night softens the score (a gentle low-pass), it never swaps the piece: `night` 0..1. */
  setNight(night: number) {
    const f = this.nightFilter;
    if (!f || !this.ctx) return;
    const hz = 16000 * Math.pow(3800 / 16000, Math.min(1, Math.max(0, night)));
    f.frequency.setTargetAtTime(hz, this.ctx.currentTime, 3);
  }

  private duckUntil = 0;
  /** A brief, subtle dip of the music under a big moment (dB below 0), recovering smoothly. */
  duck(db: number, hold: number) {
    const ctx = this.ctx;
    const d = this.duckGain;
    if (!ctx || !d) return;
    const t = ctx.currentTime;
    d.gain.cancelScheduledValues(t);
    d.gain.setTargetAtTime(dbToGain(db), t, 0.08);
    this.duckUntil = t + hold;
    d.gain.setTargetAtTime(1, t + hold, 0.9);
  }

  get ducking() {
    return !!this.ctx && this.ctx.currentTime < this.duckUntil;
  }

  /** Fetches and decodes an asset once (later calls share the promise). Missing: undefined, and remembered. */
  buffer(id: string): Promise<AudioBuffer | undefined> {
    let p = this.buffers.get(id);
    if (p) return p;
    const url = audioUrl(id);
    const ctx = this.ctx;
    if (!url || !ctx) {
      this.missing.add(id);
      return Promise.resolve(undefined);
    }
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((a) => ctx.decodeAudioData(a))
      .then((b) => {
        this.loaded.add(id);
        return b;
      })
      .catch(() => {
        this.missing.add(id);
        return undefined;
      });
    this.buffers.set(id, p);
    return p;
  }

  /** The buffer if it has already arrived (one-shots never wait on the network mid-game). */
  private ready_ = new Map<string, AudioBuffer>();
  bufferNow(id: string): AudioBuffer | undefined {
    const b = this.ready_.get(id);
    if (b) return b;
    void this.buffer(id).then((x) => x && this.ready_.set(id, x));
    return undefined;
  }

  /** Fetch these now (short, latency-sensitive effects). */
  preload(ids: string[]) {
    for (const id of ids) this.bufferNow(id);
  }

  /** A 3D output at `p` into `bus`, released when the voice ends. */
  spatialOut(p: V3, bus: BusId, refDistance: number): PannerNode | undefined {
    const ctx = this.ctx;
    const out = this.bus[bus];
    if (!ctx || !out) return undefined;
    const pn = new PannerNode(ctx, { ...SPATIAL, refDistance, positionX: p.x, positionY: p.y, positionZ: p.z });
    pn.connect(out);
    return pn;
  }

  /**
   * Plays a sample once. `pos`: a world sound (3D), else centred. Voice-limited by family; returns whether it
   * started. Rate and level variation are the caller's (kept small).
   */
  play(id: string, o: { bus: BusId; fam: Family; vol?: number; rate?: number; pos?: V3; ref?: number; key?: string; keyGap?: number; delay?: number; offset?: number }): boolean {
    const ctx = this.ctx;
    const buf = this.bufferNow(id);
    const bus = this.bus[o.bus];
    if (!ctx || !buf || !bus) return false;
    if (!this.voices.admit(o.fam, ctx.currentTime, 1, o.key, o.keyGap)) return false;
    this.voices.start(o.fam);
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: o.rate ?? 1 });
    const g = new GainNode(ctx, { gain: o.vol ?? 1 });
    const out = o.pos ? this.spatialOut(o.pos, o.bus, o.ref ?? 20) : bus;
    src.connect(g).connect(out ?? bus);
    src.start(ctx.currentTime + (o.delay ?? 0), o.offset ?? 0);
    src.onended = () => {
      this.voices.end(o.fam);
      g.disconnect();
      if (out instanceof PannerNode) out.disconnect();
    };
    return true;
  }

  /**
   * A gapless looping bed. It starts silent at a random point in the loop (two beds of one file never align) and
   * eases to whatever level is asked; nothing is heard until the buffer arrives.
   */
  loop(id: string, bus: BusId, opts: { spatial?: number; start?: number } = {}): LoopVoice | undefined {
    const ctx = this.ctx;
    const out = this.bus[bus];
    if (!ctx || !out) return undefined;
    const gain = new GainNode(ctx, { gain: 0 });
    const panner = opts.spatial ? new PannerNode(ctx, { ...SPATIAL, refDistance: opts.spatial }) : undefined;
    if (panner) gain.connect(panner).connect(out);
    else gain.connect(out);
    const v: LoopVoice = {
      id,
      bus,
      gain,
      panner,
      level: 0,
      playing: false,
      setLevel(level: number, tau = 2.5) {
        if (Math.abs(level - v.level) < 1e-4) return;
        v.level = level;
        gain.gain.setTargetAtTime(level, ctx.currentTime, tau);
      },
      moveTo(p: V3, tau = 0.3) {
        if (!panner) return;
        const t = ctx.currentTime;
        panner.positionX.setTargetAtTime(p.x, t, tau);
        panner.positionY.setTargetAtTime(p.y, t, tau);
        panner.positionZ.setTargetAtTime(p.z, t, tau);
      },
    };
    void this.buffer(id).then((buf) => {
      if (!buf) return;
      const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
      src.connect(gain);
      src.start(0, opts.start ?? Math.random() * buf.duration);
      v.playing = true;
    });
    this.loops.push(v);
    return v;
  }

  /** Sets the AudioListener at the camera (world coordinates). */
  setListener(p: V3, fwd: V3, up: V3) {
    const l = this.ctx?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx!.currentTime;
      // a short glide: a camera cut never makes a 3D source jump from one ear to the other
      l.positionX.setTargetAtTime(p.x, t, 0.03);
      l.positionY.setTargetAtTime(p.y, t, 0.03);
      l.positionZ.setTargetAtTime(p.z, t, 0.03);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.03);
      l.forwardY.setTargetAtTime(fwd.y, t, 0.03);
      l.forwardZ.setTargetAtTime(fwd.z, t, 0.03);
      l.upX.setTargetAtTime(up.x, t, 0.03);
      l.upY.setTargetAtTime(up.y, t, 0.03);
      l.upZ.setTargetAtTime(up.z, t, 0.03);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  private meter?: AnalyserNode;
  private meterBuf?: Float32Array<ArrayBuffer>;
  /** The output's level over the last ~85 ms, in dBFS (RMS and peak). */
  level(): { rms: number; peak: number } {
    const m = this.meter;
    if (!m) return { rms: -120, peak: -120 };
    this.meterBuf ??= new Float32Array(m.fftSize);
    m.getFloatTimeDomainData(this.meterBuf);
    let sum = 0;
    let pk = 0;
    for (const v of this.meterBuf) {
      sum += v * v;
      pk = Math.max(pk, Math.abs(v));
    }
    return { rms: gainToDb(Math.sqrt(sum / this.meterBuf.length)), peak: gainToDb(pk) };
  }

  /** Tests and captures: a MediaStream of the final output (after the limiter). */
  captureStream(): MediaStream | undefined {
    const ctx = this.ctx;
    if (!ctx || !this.limiterNode) return undefined;
    const d = ctx.createMediaStreamDestination();
    this.limiterNode.connect(d);
    return d.stream;
  }

  /** For the debug HUD: what is loaded, how many voices, whether the limiter is working. */
  stats() {
    return {
      state: this.ctx?.state ?? 'locked',
      voices: this.voices.total,
      reduction: this.limiterNode?.reduction ?? 0,
      out: this.level(),
      loaded: this.loaded.size,
      missing: [...this.missing],
      buses: Object.fromEntries((Object.keys(this.bus) as BusId[]).map((b) => [b, this.bus[b]!.gain.value])) as Record<BusId, number>,
    };
  }
}

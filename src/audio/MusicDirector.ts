import { type AudioDirector } from './AudioDirector';
import { audioUrl } from './AudioAssets';
import { type Mood } from './AudioMath';

export interface MusicTrack {
  /** asset id under assets/audio (music/…) */
  id: string;
  title: string;
  /** the moods it suits (the first is its home) */
  moods: Mood[];
  /** a trim (linear) so pieces sit together; the bake already normalised loudness */
  gain?: number;
}

/**
 * The score (human-composed and human-performed; see docs/audio/ASSET_MANIFEST.csv). A mood with no track of
 * its own borrows the nearest one (garden ← water, quiet ← night).
 */
export const MUSIC: MusicTrack[] = [
  // Frédéric Chopin, Nocturnes: Musopen's public-domain (CC0) recordings of real pianists (see the manifest)
  { id: 'music/nocturne-op9-no2', title: 'Nocturne in E-flat major, Op. 9 No. 2', moods: ['garden', 'water'] },
  { id: 'music/nocturne-op55-no2', title: 'Nocturne in E-flat major, Op. 55 No. 2', moods: ['water', 'garden', 'night'], gain: 0.85 },
  { id: 'music/nocturne-op72-no1', title: 'Nocturne in E minor, Op. 72 No. 1', moods: ['quiet', 'night'] },
];

/** Seconds of silence between two pieces: silence is part of the score. */
export const REST = { min: 35, max: 90, first: 6 };
/** Crossfade when a piece has to give way (seconds). */
export const XFADE = 5;
/** A new mood must hold this long before the playing piece gives way to it. */
export const MOOD_HOLD = 40;

const BORROW: Record<Mood, Mood[]> = { quiet: ['quiet', 'night', 'garden'], garden: ['garden', 'water', 'quiet'], water: ['water', 'garden'], night: ['night', 'quiet', 'garden'] };

/** The track to play for `mood`, never the one just played if there is another. Pure (tests). */
export function pickTrack(tracks: MusicTrack[], mood: Mood, last?: string, rnd = Math.random): MusicTrack | undefined {
  for (const m of BORROW[mood]) {
    const fit = tracks.filter((t) => t.moods.includes(m));
    if (!fit.length) continue;
    const fresh = fit.filter((t) => t.id !== last);
    const pool = fresh.length ? fresh : fit;
    return pool[Math.floor(rnd() * pool.length)];
  }
  return undefined;
}

interface Playing {
  track: MusicTrack;
  el: HTMLAudioElement;
  gain: GainNode;
  mood: Mood;
}

/**
 * Phase 8 A03: one piece at a time, streamed (never decoded whole), each played through to its end and followed
 * by a rest. Nothing restarts on a camera switch or a small move: only a mood that has held for MOOD_HOLD
 * seconds, and that the playing piece does not suit, crossfades to another. Restoration opens the score up
 * (`intensity`), night softens it (AudioDirector.setNight), and big moments duck it a little.
 */
export class MusicDirector {
  private cur?: Playing;
  private fading: Playing[] = [];
  private rest = REST.first;
  private moodNow?: Mood;
  private moodFor = 0;
  private last?: string;
  /** 0..1 how open the score is: restoration brings it up from a hushed start */
  intensity = 0.6;
  /** for the debug HUD */
  status = 'waiting';

  constructor(
    private readonly a: AudioDirector,
    readonly tracks = MUSIC,
  ) {}

  get playing(): string | undefined {
    return this.cur?.track.title;
  }

  /** `mood`: undefined while the world waits in silence (nothing restored yet). Call a few times a second. */
  update(dt: number, mood: Mood | undefined) {
    if (!this.a.ready) return;
    if (mood !== this.moodNow) {
      this.moodNow = mood;
      this.moodFor = 0;
    } else this.moodFor += dt;
    const cur = this.cur;
    if (cur) {
      cur.gain.gain.setTargetAtTime(this.level(cur.track), this.a.now(), 2);
      const suits = mood && cur.track.moods.includes(mood);
      if (!mood && this.moodFor > 4) this.stop(XFADE * 2); // back to the beginning: hush
      else if (mood && !suits && this.moodFor > MOOD_HOLD && this.better(mood)) this.stop(XFADE, true);
      else this.status = `${cur.track.title} (${Math.floor(cur.el.currentTime)}/${Math.floor(cur.el.duration || 0)} s)`;
      return;
    }
    if (!mood) {
      this.status = 'silence: the world waits';
      return;
    }
    this.rest -= dt;
    this.status = `rest ${Math.max(0, this.rest).toFixed(0)} s (${mood})`;
    if (this.rest > 0) return;
    const t = pickTrack(this.tracks, mood, this.last);
    if (t) this.begin(t, mood);
    else this.rest = 30;
  }

  /** Is there a track that suits `mood` better than the one playing? */
  private better(mood: Mood) {
    return this.tracks.some((t) => t.moods.includes(mood));
  }

  private level(t: MusicTrack) {
    return (t.gain ?? 1) * (0.7 + 0.3 * this.intensity);
  }

  private begin(track: MusicTrack, mood: Mood, fade = XFADE) {
    const ctx = this.a.ctx;
    const into = this.a.musicIn();
    const url = audioUrl(track.id);
    if (!ctx || !into || !url) {
      this.a.missing.add(track.id);
      this.rest = 30;
      return;
    }
    try {
      const el = new Audio(url);
      el.preload = 'auto';
      el.loop = false;
      const gain = new GainNode(ctx, { gain: 0 });
      ctx.createMediaElementSource(el).connect(gain).connect(into);
      gain.gain.setTargetAtTime(this.level(track), ctx.currentTime, fade / 3);
      const p: Playing = { track, el, gain, mood };
      el.addEventListener('ended', () => {
        if (this.cur === p) {
          this.cur = undefined;
          this.rest = REST.min + Math.random() * (REST.max - REST.min);
        }
        this.release(p);
      });
      void el.play().catch(() => {});
      this.cur = p;
      this.last = track.id;
    } catch {
      this.rest = 30;
    }
  }

  /** Fades the playing piece out over `fade` s; `soon`: the next begins after a short breath instead of a rest. */
  private stop(fade: number, soon = false) {
    const p = this.cur;
    if (!p) return;
    this.cur = undefined;
    p.gain.gain.setTargetAtTime(0, this.a.now(), fade / 3);
    this.fading.push(p);
    setTimeout(() => this.release(p), fade * 1000 + 500);
    this.rest = soon ? 3 : REST.first + 10;
  }

  private release(p: Playing) {
    p.el.pause();
    p.el.removeAttribute('src');
    p.el.load();
    p.gain.disconnect();
    this.fading = this.fading.filter((q) => q !== p);
  }
}

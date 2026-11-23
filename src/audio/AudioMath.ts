/**
 * Phase 8 (audio): the pure parts of the sound system, kept free of Web Audio so they can be unit-tested. The
 * AudioDirector and SoundscapeDirector call these; nothing here touches an AudioContext.
 */

/** 0 below `a`, 1 above `b`, smooth in between. */
export const ramp = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => (g <= 1e-6 ? -120 : 20 * Math.log10(g));

// ───────────────────────── mix buses ─────────────────────────

export type BusId = 'music' | 'ambience' | 'sfx' | 'ui';

/** The player's mix (0..1 each), from Settings. `sfxOn` / `musicOn` are the on/off checks. */
export interface MixSettings {
  master: number;
  music: number;
  ambience: number;
  sfx: number;
  ui: number;
  sfxOn: boolean;
  musicOn: boolean;
}

/**
 * Calibration: the level each bus sits at when its slider is at 100%. Assets are loudness-normalised when baked
 * (tools/audio/bake.py: music to -18 LUFS, beds to -24 LUFS), so these trims are the whole mix. With them the
 * restored exploration mix has the ambience roughly 8 dB under the music (docs/audio/AUDIO_MIX_NOTES.md).
 */
export const BUS_TRIM: Record<BusId, number> = { music: 0.42, ambience: 1, sfx: 0.5, ui: 0.32 };

/** The gain each bus should have now. A bus that is switched off is 0; the master scales them all. */
export function busGains(m: MixSettings): Record<BusId, number> {
  const k = clamp01(m.master);
  return {
    music: m.musicOn ? k * clamp01(m.music) * BUS_TRIM.music : 0,
    ambience: k * clamp01(m.ambience) * BUS_TRIM.ambience,
    sfx: m.sfxOn ? k * clamp01(m.sfx) * BUS_TRIM.sfx : 0,
    ui: m.sfxOn ? k * clamp01(m.ui) * BUS_TRIM.ui : 0,
  };
}

// ───────────────────────── local restoration ─────────────────────────

/** What the soundscape needs to know about one tile (the sampler's view of the grid). */
export interface TileSound {
  /** 'polluted' | 'prepared' | 'growing' | 'restored' */
  ground: string;
  /** 1..3 once restored */
  bloom: number;
  /** clean (restored) open water */
  water?: boolean;
  /** a tree stage 0..4 standing here (0: none) */
  tree?: number;
  /** a solid thing (building, ruin, obstacle): not ground that can live */
  solid?: boolean;
}

/** How alive the ground around the listener is. All 0..1. */
export interface AreaSound {
  /** overall restoration: 0 dead, 1 lush */
  life: number;
  /** grass, flowers and shrubs (what rustles) */
  vegetation: number;
  /** grown trees (where birds live) */
  canopy: number;
  /** clean water nearby */
  water: number;
  /** how much of the sampled ground could be read at all (0: nothing loaded yet) */
  coverage: number;
}

export const DEAD_AREA: AreaSound = { life: 0, vegetation: 0, canopy: 0, water: 0, coverage: 0 };

/** One tile's life, 0..1: polluted ground is dead; restored ground grows more alive with its bloom. */
export function tileLife(t: TileSound): number {
  switch (t.ground) {
    case 'restored':
      return 0.55 + 0.15 * Math.min(3, Math.max(0, t.bloom));
    case 'growing':
      return 0.3;
    case 'prepared':
      return 0.12;
    default:
      return 0;
  }
}

/**
 * The soundscape's local restoration signal: tiles within `radius` of (cx, cz), weighted toward the closest
 * (so the boundary of a restored patch is heard as a gradient, not a step). `get` returns undefined for tiles not
 * generated yet. Pure and cheap: called a few times a second, never at audio rate.
 */
export function sampleArea(get: (x: number, z: number) => TileSound | undefined, cx: number, cz: number, radius = 12, step = 1): AreaSound {
  let w = 0, life = 0, veg = 0, canopy = 0, water = 0, seen = 0, total = 0;
  const r2 = radius * radius;
  for (let dz = -radius; dz <= radius; dz += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      total++;
      const t = get(Math.floor(cx + dx), Math.floor(cz + dz));
      if (!t) continue;
      seen++;
      const k = 1 - Math.sqrt(d2) / (radius + 1);
      const kk = k * k;
      if (t.water) {
        water += kk;
        continue; // water is heard as water, not as ground
      }
      if (t.solid) continue;
      w += kk;
      const l = tileLife(t);
      life += kk * l;
      if (t.ground === 'restored') veg += kk * (0.4 + 0.2 * Math.min(3, t.bloom));
      if (t.tree && t.tree >= 2) canopy += kk * ((t.tree - 1) / 3);
    }
  }
  if (!seen) return { ...DEAD_AREA };
  return {
    life: w ? life / w : 0,
    vegetation: w ? clamp01(veg / w) : 0,
    // a handful of grown trees is a canopy: they are sparse on the grid
    canopy: w ? clamp01((canopy / w) * 6) : 0,
    water: clamp01(water / 6),
    coverage: seen / total,
  };
}

/** Eases `cur` toward `target` with a time constant `tau` seconds (frame-rate independent). */
export function follow(cur: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  return cur + (target - cur) * (1 - Math.exp(-dt / tau));
}

/** Smooths an AreaSound field by field. Rising life is slower than fading (life returning is earned). */
export function followArea(cur: AreaSound, target: AreaSound, dt: number, tauUp = 6, tauDown = 4): AreaSound {
  const f = (a: number, b: number) => follow(a, b, dt, b > a ? tauUp : tauDown);
  return { life: f(cur.life, target.life), vegetation: f(cur.vegetation, target.vegetation), canopy: f(cur.canopy, target.canopy), water: f(cur.water, target.water), coverage: target.coverage };
}

// ───────────────────────── soundscape stages ─────────────────────────

export type Stage = 'barren' | 'firstSprout' | 'recovering' | 'thriving' | 'radiant';
export const STAGES: readonly Stage[] = ['barren', 'firstSprout', 'recovering', 'thriving', 'radiant'];

/** The art-direction stage for a local life (with a little hysteresis so a border never flutters between two). */
export function stageOf(life: number, prev?: Stage): Stage {
  const edges = [0.08, 0.25, 0.5, 0.8];
  let i = edges.findIndex((e) => life < e);
  if (i < 0) i = 4;
  if (prev) {
    const p = STAGES.indexOf(prev);
    // stay unless clearly past the edge between them
    if (i === p + 1 && life < edges[p] + 0.03) i = p;
    if (i === p - 1 && life > edges[i] - 0.03) i = p;
  }
  return STAGES[i];
}

/** What the soundscape hears: the local area, the time of day, the whole world's progress, the weather. */
export interface SoundscapeInput {
  area: AreaSound;
  /** daylight 0 (night) .. 1 (day) */
  daylight: number;
  /** the whole world's restoration 0..1 (only colours the music, never the local ambience) */
  world: number;
  /** wind strength from the weather, 0..1 */
  wind: number;
  /** rain 0..1 */
  rain?: number;
}

/** Each ambience bed's target gain (before the ambience bus). Pure: the heart of "dead → living". */
export interface BedLevels {
  /** thin dry wind: the dead world's only constant; a breath always stays */
  wind: number;
  /** leaves and grass moving in the breeze: vegetation */
  leaves: number;
  /** a daytime meadow bed: only where it's well restored and the sun is up */
  meadow: number;
  /** night insects in restored ground */
  night: number;
}

export function bedLevels(s: SoundscapeInput): BedLevels {
  const a = s.area;
  const day = clamp01(s.daylight);
  const night = 1 - ramp(day, 0.25, 0.6);
  const gust = 0.75 + 0.5 * clamp01(s.wind);
  return {
    wind: 0.2 * gust * (1 - 0.7 * ramp(a.life, 0.1, 0.75)),
    leaves: 0.3 * ramp(a.vegetation, 0.1, 0.65) * (0.6 + 0.4 * clamp01(s.wind)),
    meadow: 0.26 * ramp(a.life, 0.45, 0.9) * ramp(day, 0.35, 0.7),
    night: 0.22 * ramp(a.life, 0.4, 0.9) * night,
  };
}

/** How often (per second) a wildlife call happens near the listener; 0 in dead ground. */
export function birdRate(s: SoundscapeInput): number {
  const day = ramp(s.daylight, 0.3, 0.65);
  const habitat = Math.max(s.area.canopy, 0.6 * ramp(s.area.life, 0.35, 0.85));
  return day * habitat * 0.22; // one call every ~4.5 s at the most
}

/** How often a distant ruin creak happens: only in dead ground, rarely. */
export function creakRate(s: SoundscapeInput): number {
  return (1 - ramp(s.area.life, 0.05, 0.35)) * (1 / 35);
}

// ───────────────────────── music moods ─────────────────────────

export type Mood = 'quiet' | 'garden' | 'water' | 'night';

/**
 * Which kind of music suits now. `restoredOnce`: the player has restored anything at all (before that the world
 * waits in silence). Water: lots of clean water near. Night: the moon is up.
 */
export function moodFor(s: SoundscapeInput, restoredOnce: boolean): Mood | undefined {
  if (!restoredOnce) return undefined;
  if (s.daylight < 0.3) return 'night';
  if (s.area.life < 0.2 && s.world < 0.15) return 'quiet';
  if (s.area.water > 0.5 && s.area.life > 0.3) return 'water';
  return s.world < 0.08 && s.area.life < 0.35 ? 'quiet' : 'garden';
}

// ───────────────────────── voices and repetition ─────────────────────────

/** Sound families: each has its own concurrency cap, cooldown and priority. */
export type Family = 'restore' | 'chain' | 'stage' | 'build' | 'economy' | 'drone' | 'footstep' | 'wildlife' | 'ui' | 'event' | 'cat';

export interface FamilyRule {
  /** most voices of this family at once */
  max: number;
  /** least seconds between two triggers */
  gap: number;
  /** higher wins a voice when the whole pool is full */
  priority: number;
}

/** Priority: critical actions > rewards > local world detail > background. */
export const FAMILIES: Record<Family, FamilyRule> = {
  event: { max: 10, gap: 0.4, priority: 5 },
  cat: { max: 6, gap: 0.3, priority: 5 },
  ui: { max: 3, gap: 0.04, priority: 4 },
  build: { max: 4, gap: 0.08, priority: 4 },
  restore: { max: 6, gap: 0.06, priority: 4 },
  economy: { max: 3, gap: 0.07, priority: 3 },
  chain: { max: 6, gap: 0.06, priority: 3 },
  stage: { max: 5, gap: 0.07, priority: 2 },
  footstep: { max: 2, gap: 0.12, priority: 2 },
  drone: { max: 3, gap: 0.15, priority: 1 },
  wildlife: { max: 3, gap: 0.8, priority: 1 },
};

/** The whole pool (every family together). */
export const MAX_VOICES = 24;

/**
 * Voice bookkeeping: whether a sound may start now. Counts are released by the caller when a voice ends.
 * `reduced`: the "reduced repetitive effects" setting doubles every gap and halves the caps of the busiest families.
 */
export class VoiceLimiter {
  private live: Partial<Record<Family, number>> = {};
  private last: Partial<Record<Family, number>> = {};
  private keyLast = new Map<string, number>();
  total = 0;
  reduced = false;

  constructor(readonly rules = FAMILIES, readonly maxVoices = MAX_VOICES) {}

  /** May a sound of `fam` start at `now` (seconds)? `key` adds a per-sound cooldown (e.g. one per drone role). */
  admit(fam: Family, now: number, voices = 1, key?: string, keyGap = 0): boolean {
    const r = this.rules[fam];
    const gap = r.gap * (this.reduced ? 2 : 1);
    const max = this.reduced && (fam === 'chain' || fam === 'stage' || fam === 'drone' || fam === 'economy') ? Math.max(1, Math.floor(r.max / 2)) : r.max;
    if (now - (this.last[fam] ?? -1e9) < gap) return false;
    if (key && now - (this.keyLast.get(key) ?? -1e9) < keyGap * (this.reduced ? 2 : 1)) return false;
    if ((this.live[fam] ?? 0) + voices > max) return false;
    // the pool is full: only sounds that matter more than background detail still start
    if (this.total + voices > this.maxVoices && r.priority < 4) return false;
    this.last[fam] = now;
    if (key) this.keyLast.set(key, now);
    return true;
  }

  start(fam: Family, voices = 1) {
    this.live[fam] = (this.live[fam] ?? 0) + voices;
    this.total += voices;
  }

  end(fam: Family, voices = 1) {
    this.live[fam] = Math.max(0, (this.live[fam] ?? 0) - voices);
    this.total = Math.max(0, this.total - voices);
  }

  count(fam: Family) {
    return this.live[fam] ?? 0;
  }
}

/** Picks a variation index without repeating the last one (with fewer than 2 variations, always 0). */
export function pickVariant(n: number, last: number, rnd = Math.random): number {
  if (n <= 1) return 0;
  const i = Math.floor(rnd() * (n - 1));
  return i >= last ? i + 1 : i;
}

// ───────────────────────── Bloom Chain escalation ─────────────────────────

/**
 * A chain's tone for its `combo`-th bloom, as an aggregated event: the pitch climbs a pentatonic ladder but stays
 * within two octaves (wrapping by inversion, never into a piercing register), the chord thickens as the chain
 * grows, and the level falls as blooms come faster, so 50 blooms are a rising texture rather than 50 pings.
 * `rate`: blooms per second lately.
 */
export function chainTone(combo: number, rate: number): { step: number; voices: number; vol: number; bright: number } {
  // climb for the first 10, then wander up and down the top of the ladder
  const climb = combo <= 10 ? combo : 10 + ((combo - 10) % 6 < 3 ? (combo - 10) % 3 : 3 - ((combo - 10) % 3));
  const step = Math.min(10, climb); // 10 pentatonic steps = two octaves
  const voices = combo < 5 ? 1 : combo < 15 ? 2 : 3;
  const vol = 0.14 / Math.sqrt(1 + Math.max(0, rate - 4) / 4) / Math.sqrt(voices);
  const bright = clamp01(combo / 30);
  return { step, voices, vol, bright };
}

/** The music's brief dip under a big moment: depth in dB and how long it holds, by how big it is (0..1). */
export function duckFor(size: number): { db: number; hold: number } {
  const s = clamp01(size);
  return { db: -(1 + 2 * s), hold: 1.2 + 2.8 * s };
}

// ───────────────────────── footsteps ─────────────────────────

export type Surface = 'grass' | 'dirt' | 'stone' | 'wood' | 'sand' | 'water';

/** The surface under a footstep, from a tile's feature and ground (and whether it is a bridge or deck). */
export function surfaceOf(feature: string | undefined, ground: string | undefined, opts: { bridge?: boolean; wading?: boolean } = {}): Surface {
  if (opts.wading) return 'water';
  if (opts.bridge) return 'wood';
  switch (feature) {
    case 'water':
      return 'water';
    case 'sand':
      return 'sand';
    case 'paving':
    case 'road':
    case 'building':
      return 'stone';
    case 'clay':
    case 'litter':
      return 'dirt';
    default:
      // lawn and open ground: grass once it lives, else dry dirt
      return ground === 'restored' || ground === 'growing' ? 'grass' : 'dirt';
  }
}

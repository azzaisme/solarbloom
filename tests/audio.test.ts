import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  bedLevels,
  birdRate,
  busGains,
  chainTone,
  creakRate,
  DEAD_AREA,
  duckFor,
  followArea,
  moodFor,
  pickVariant,
  sampleArea,
  stageOf,
  surfaceOf,
  type TileSound,
  VoiceLimiter,
} from '../src/audio/AudioMath';
import { MUSIC, pickTrack } from '../src/audio/MusicDirector';

/** A world where tiles with x >= border are restored and lush, the rest dead. */
const split = (border: number, opts: { trees?: boolean; water?: boolean } = {}) => (x: number, _z: number): TileSound =>
  x >= border ? { ground: 'restored', bloom: 3, tree: opts.trees && x % 4 === 0 ? 4 : 0, water: opts.water && x % 3 === 0 } : { ground: 'polluted', bloom: 0 };

const day = (area = DEAD_AREA) => ({ area, daylight: 1, world: 0, wind: 0.3 });

describe('Phase 8 A04: dead → living is local', () => {
  it('a dead area samples dead, a restored one alive, and the border is a gradient, not a step', () => {
    const w = split(0, { trees: true });
    const dead = sampleArea(w, -40, 0);
    const alive = sampleArea(w, 40, 0);
    const border = sampleArea(w, 0, 0);
    expect(dead.life).toBe(0);
    expect(alive.life).toBeGreaterThan(0.95);
    expect(alive.canopy).toBeGreaterThan(0.3);
    expect(border.life).toBeGreaterThan(0.3);
    expect(border.life).toBeLessThan(0.7);
    // nearer the garden sounds more alive
    expect(sampleArea(w, 4, 0).life).toBeGreaterThan(sampleArea(w, -4, 0).life);
  });

  it('nothing loaded yet reads as dead with no coverage (never a burst of lush sound)', () => {
    const a = sampleArea(() => undefined, 0, 0);
    expect(a).toEqual(DEAD_AREA);
  });

  it('dead ground has wind only: no leaves, meadow, insects, birds', () => {
    const l = bedLevels(day());
    expect(l.wind).toBeGreaterThan(0.1);
    expect(l.leaves + l.meadow + l.night).toBe(0);
    expect(birdRate(day())).toBe(0);
    expect(creakRate(day())).toBeGreaterThan(0);
    // at night as well: dead ground has no insects
    expect(bedLevels({ ...day(), daylight: 0 }).night).toBe(0);
  });

  it('thriving ground: the wind steps back, leaves and meadow come in by day, insects by night; ruins fall silent', () => {
    const area = sampleArea(split(-100, { trees: true }), 0, 0);
    const d = bedLevels(day(area));
    const n = bedLevels({ ...day(area), daylight: 0 });
    expect(d.wind).toBeLessThan(bedLevels(day()).wind * 0.5);
    expect(d.leaves).toBeGreaterThan(0.1);
    expect(d.meadow).toBeGreaterThan(0.1);
    expect(d.night).toBe(0);
    expect(n.night).toBeGreaterThan(0.1);
    expect(n.meadow).toBe(0);
    expect(birdRate(day(area))).toBeGreaterThan(0.1);
    expect(birdRate({ ...day(area), daylight: 0 })).toBe(0);
    expect(creakRate(day(area))).toBe(0);
  });

  it('a thriving world elsewhere never brings life into a dead area (the world score only colours the music)', () => {
    const l = bedLevels({ ...day(), world: 1 });
    expect(l.leaves + l.meadow + l.night).toBe(0);
    expect(birdRate({ ...day(), world: 1 })).toBe(0);
  });

  it('crossing a border glides over seconds (5–12 s), with no flutter when running back and forth', () => {
    const alive = { life: 1, vegetation: 1, canopy: 1, water: 0, coverage: 1 };
    let a = { ...DEAD_AREA };
    let t = 0;
    while (a.life < 0.9) {
      a = followArea(a, alive, 0.25);
      t += 0.25;
    }
    expect(t).toBeGreaterThanOrEqual(5);
    expect(t).toBeLessThanOrEqual(16);
    // dashing across every second: the level moves gently, the stage does not flicker
    let stage = stageOf(a.life);
    let changes = 0;
    for (let i = 0; i < 80; i++) {
      a = followArea(a, i % 8 < 4 ? alive : DEAD_AREA, 0.25);
      const s = stageOf(a.life, stage);
      if (s !== stage) changes++;
      stage = s;
    }
    expect(changes).toBeLessThan(25);
  });

  it('five stages in order', () => {
    expect([0, 0.15, 0.4, 0.7, 0.95].map((x) => stageOf(x))).toEqual(['barren', 'firstSprout', 'recovering', 'thriving', 'radiant']);
  });
});

describe('Phase 8 A03: music', () => {
  it('silence until the first restoration; night and water moods follow the world', () => {
    expect(moodFor(day(), false)).toBeUndefined();
    expect(moodFor(day(), true)).toBe('quiet');
    expect(moodFor({ ...day(), daylight: 0.1 }, true)).toBe('night');
    const lake = { life: 0.6, vegetation: 0.5, canopy: 0.2, water: 0.8, coverage: 1 };
    expect(moodFor(day(lake), true)).toBe('water');
    expect(moodFor({ ...day({ ...lake, water: 0 }), world: 0.4 }, true)).toBe('garden');
  });

  it('a track for every mood, never the same piece twice in a row when there is another', () => {
    const tracks = [
      { id: 'a', title: 'A', moods: ['garden' as const] },
      { id: 'b', title: 'B', moods: ['garden' as const, 'water' as const] },
      { id: 'n', title: 'N', moods: ['night' as const] },
    ];
    for (let i = 0; i < 20; i++) expect(pickTrack(tracks, 'garden', 'a')!.id).toBe('b');
    expect(pickTrack(tracks, 'quiet')!.id).toBe('n'); // borrows night
    expect(pickTrack(tracks, 'water')!.id).toBe('b');
    expect(pickTrack([], 'garden')).toBeUndefined();
  });

  it('every shipped music track exists in the build and is in the manifest', () => {
    const manifest = readFileSync('docs/audio/ASSET_MANIFEST.csv', 'utf8');
    for (const t of MUSIC) {
      expect(existsSync(`assets/audio/${t.id}.ogg`), t.id).toBe(true);
      expect(manifest, t.id).toContain(`${t.id}.ogg`);
    }
  });
});

describe('Phase 8 A02/A06: mix and repetition', () => {
  it('buses: off is silent, the master scales all, sliders are clamped', () => {
    const g = busGains({ master: 0.5, music: 1, ambience: 1, sfx: 2, ui: 1, sfxOn: false, musicOn: true });
    expect(g.sfx).toBe(0);
    expect(g.ui).toBe(0);
    expect(g.music).toBeGreaterThan(0);
    const full = busGains({ master: 1, music: 1, ambience: 1, sfx: 1, ui: 1, sfxOn: true, musicOn: true });
    expect(g.music).toBeCloseTo(full.music / 2);
    expect(busGains({ master: 0, music: 1, ambience: 1, sfx: 1, ui: 1, sfxOn: true, musicOn: true }).ambience).toBe(0);
  });

  it('a 50-bloom chain at 25 blooms a second: few voices, a bounded register, softer as it speeds up', () => {
    const lim = new VoiceLimiter();
    let started = 0;
    let maxStep = 0;
    for (let i = 1; i <= 50; i++) {
      const t = i / 25;
      if (!lim.admit('chain', t, 1, 'bloom', 0.07)) continue;
      started++;
      const c = chainTone(i, 25);
      maxStep = Math.max(maxStep, c.step + (c.voices - 1) * 2);
      expect(c.vol).toBeLessThan(chainTone(i, 2).vol + 1e-9);
    }
    expect(started).toBeLessThanOrEqual(30);
    expect(maxStep).toBeLessThanOrEqual(14); // under three octaves of pentatonic steps, never piercing
  });

  it('families have caps and cooldowns; the reduced setting doubles the gaps', () => {
    const lim = new VoiceLimiter();
    expect(lim.admit('drone', 0)).toBe(true);
    expect(lim.admit('drone', 0.05)).toBe(false);
    lim.start('footstep');
    lim.start('footstep');
    expect(lim.admit('footstep', 5)).toBe(false); // two at once at most
    const r = new VoiceLimiter();
    r.reduced = true;
    expect(r.admit('drone', 0)).toBe(true);
    expect(r.admit('drone', 0.2)).toBe(false);
    expect(r.admit('drone', 0.31)).toBe(true);
  });

  it('variations never repeat back to back', () => {
    let last = -1;
    for (let i = 0; i < 200; i++) {
      const v = pickVariant(4, last);
      expect(v).not.toBe(last);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
      last = v;
    }
    expect(pickVariant(1, 0)).toBe(0);
  });

  it('ducks are subtle (1–3 dB) and recover', () => {
    expect(duckFor(0).db).toBe(-1);
    expect(duckFor(1).db).toBe(-3);
    expect(duckFor(5).hold).toBeLessThan(5);
  });

  it('footstep surfaces', () => {
    expect(surfaceOf('lawn', 'restored')).toBe('grass');
    expect(surfaceOf('lawn', 'polluted')).toBe('dirt');
    expect(surfaceOf('paving', 'restored')).toBe('stone');
    expect(surfaceOf('paving', 'restored', { bridge: true })).toBe('wood');
    expect(surfaceOf('lawn', 'restored', { wading: true })).toBe('water');
    expect(surfaceOf('sand', 'polluted')).toBe('sand');
  });
});

describe('Phase 8 A01/A08: shipped audio', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk('assets/audio');

  it('every shipped file has a manifest row with a creator, a source and a licence', () => {
    const rows = readFileSync('docs/audio/ASSET_MANIFEST.csv', 'utf8').trim().split('\n').slice(1);
    for (const f of files) {
      const row = rows.find((r) => r.includes(f.replace(/^assets\/audio\//, '')));
      expect(row, f).toBeTruthy();
      const cols = row!.split(',');
      expect(cols[3], `${f} creator`).not.toBe('');
      expect(row, `${f} licence`).toMatch(/CC0|Public Domain|designed in-house/i);
    }
  });

  it('the grating beds are gone: no 1.9 s hiss loop, no drone hum, nothing streamed as an <audio> loop', () => {
    const sfx = readFileSync('src/audio/Sfx.ts', 'utf8') + readFileSync('src/audio/SoundscapeDirector.ts', 'utf8') + readFileSync('src/audio/AudioDirector.ts', 'utf8');
    expect(sfx).not.toMatch(/water-flowing|city-hum/);
    expect(sfx).not.toMatch(/el\.loop = true/);
    expect(files.some((f) => /water-flowing|city-hum/.test(f))).toBe(false);
  });

  it('loops baked seamless and peaks under -1 dBFS (bake report)', () => {
    const rep = JSON.parse(readFileSync('docs/audio/bake-report.json', 'utf8')) as Record<string, { peak_dbfs: number; seam?: number }>;
    for (const [id, r] of Object.entries(rep)) {
      expect(r.peak_dbfs, id).toBeLessThanOrEqual(-0.9);
      if (r.seam !== undefined) expect(r.seam, id).toBeLessThan(3);
    }
  });
});

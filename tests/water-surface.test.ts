import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { LOOK } from '../src/data/look';
import { waterDistance } from '../src/rendering/ChunkRenderer';
import { obliqueClip } from '../src/rendering/WaterReflection';
import { readFileSync } from 'node:fs';
import { resetWaterDisturbers, setWaterCovers, setWaterDisturbers } from '../src/rendering/WaterDisturbance';
import {
  COVER_MAX,
  DISTURB_MAX,
  RIPPLE_RANGE,
  RIPPLE_RES,
  WATER_CLARITY,
  WATER_ENC,
  WAVES_ANCHOR,
  encodeWater,
  rippleDrift,
  rippleMapData,
  setWaterFrame,
  waterCalm,
  waterColourAt,
  waterFade,
  waterFresnel,
  waterMaterial,
  waterReflectOn,
  waterWaves,
  waveParams,
} from '../src/rendering/WaterSurface';

/**
 * E28.W01 (#694): one water surface for the sea, its shallows, the surf and restored pools. Turquoise by the shore,
 * deeper blue-teal further out, never neon; a Fresnel reflection that stays a reflection, not a mirror; a planar
 * reflection on High only (never on the Steam Deck preset, which runs Medium).
 */
const hsv = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
};

describe('water look values', () => {
  const W = LOOK.water;

  it("runs from the owner's shallow turquoise to a bluer, darker deep teal", () => {
    expect(W.shallow.toLowerCase()).toBe('#53c9cb');
    expect(W.deep.toLowerCase()).toBe('#176b83');
    const s = hsv(W.shallow);
    const d = hsv(W.deep);
    expect(s.h).toBeGreaterThan(170);
    expect(s.h).toBeLessThan(190);
    expect(d.h).toBeGreaterThan(s.h);
    expect(d.h).toBeLessThan(215);
    expect(d.v).toBeLessThan(s.v);
  });

  it('no fluorescent cyan: every water colour stays well short of full saturation at full brightness', () => {
    for (const c of [W.shallow, W.deep, W.murky]) {
      const { s, v } = hsv(c);
      expect(s * v, c).toBeLessThan(0.6);
      expect(v, c).toBeLessThan(0.85);
    }
    // the murky surf is greyer than the clear sea
    expect(hsv(W.murky).s).toBeLessThan(hsv(W.shallow).s * 0.6);
  });

  it('by night the water turns the approved moonlit navy: dark, blue well ahead of green, green ahead of red', () => {
    const n = parseInt(W.night.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    expect(b).toBeGreaterThan(g * 2);
    expect(g).toBeGreaterThan(r);
    expect(hsv(W.night).v).toBeLessThan(0.65);
    expect(hsv(W.night).h).toBeGreaterThan(210);
    expect(hsv(W.night).h).toBeLessThan(235);
  });

  it('the sky fills the water with a little blue light, never more than its own lit colour', () => {
    expect(W.ambient).toBeGreaterThan(0);
    expect(W.ambient).toBeLessThanOrEqual(0.8);
    expect(W.sky).toBeGreaterThan(0);
    expect(W.sky).toBeLessThanOrEqual(1);
    expect(W.reflectTint).toBeGreaterThanOrEqual(0);
    expect(W.reflectTint).toBeLessThanOrEqual(0.6); // a cast, not a recolour: the reflection still shows what it reflects
  });

  it('far waves fade only once they are truly too fine to draw, and their variance roughens the highlight (no pixel sparkle)', () => {
    const A = W.antiAlias;
    expect(A.variance).toBeGreaterThan(0);
    // a wave keeps its shape until it's only a few pixels long (so the mid and far sea still read as waves), and is
    // gone before it's down to the two pixels where it could only shimmer
    expect(A.fadeFrom).toBeGreaterThanOrEqual(4);
    expect(A.fadeFrom).toBeLessThanOrEqual(8);
    expect(A.fadeTo).toBeGreaterThanOrEqual(2);
    expect(A.fadeTo).toBeLessThan(A.fadeFrom);
    // a narrow window: each band drops out on its own rather than all of them smearing together
    expect(A.fadeFrom / A.fadeTo).toBeLessThanOrEqual(2.5);
    // the shader gets them as fractions of a wavelength per pixel
    const aa = (waterMaterial().getParameter('uWaterAA') as { data?: number[] } | undefined)?.data as number[];
    const e = (waterMaterial().getParameter('uWaterWaveE') as { data?: number[] } | undefined)?.data as number[];
    expect(e[1]).toBeCloseTo(1 / A.fadeFrom, 9);
    expect(e[2]).toBeCloseTo(1 / A.fadeTo, 9);
    expect(aa[0]).toBe(A.variance);
    // the small ripples fade much earlier (they're only a few pixels long well before the large waves are): what keeps
    // the far night sea free of single-pixel moon specks
    expect(A.rippleFrom).toBeGreaterThan(A.fadeFrom);
    expect(A.rippleTo).toBeLessThan(A.rippleFrom);
    expect(aa[1]).toBeCloseTo(1 / A.rippleFrom, 9);
    expect(aa[2]).toBeCloseTo(1 / A.rippleTo, 9);
    expect(aa[3]).toBeCloseTo((W.ripples.min + W.ripples.max) / 2, 9);
  });

  it('distances and strengths sit in sensible ranges', () => {
    expect(W.deepAt).toBeGreaterThan(1);
    expect(W.deepAt).toBeLessThanOrEqual(WATER_ENC);
    expect(W.ripples.strength).toBeGreaterThan(0);
    expect(W.ripples.strength).toBeLessThan(0.3); // subtle, not choppy
    expect(W.lap.strength).toBeLessThan(0.3);
    expect(W.gloss).toBeGreaterThan(0.6);
    expect(W.gloss).toBeLessThan(0.95); // a soft-capped highlight, not a pin-point that blooms
    expect(W.specular).toBeLessThanOrEqual(0.6);
    expect(W.reflect.strength).toBeGreaterThan(0);
    expect(W.reflect.strength).toBeLessThan(1); // visible, not a mirror
    expect(W.reflect.scale).toBeGreaterThan(0.2);
    expect(W.reflect.scale).toBeLessThanOrEqual(0.5); // half size at most: a cheap pass
    expect(Number.isInteger(W.reflect.every)).toBe(true);
    expect(W.reflect.every).toBeGreaterThanOrEqual(1);
    expect(W.reflect.every).toBeLessThanOrEqual(2); // any staler and the reflection would trail the camera
    expect(W.nightAlbedo).toBeGreaterThan(0.3);
    expect(W.nightAlbedo).toBeLessThan(1);
  });

  it('the large waves: several, each its own direction, low (0.02 to 0.05 a tile) and long (3 to 6 tiles)', () => {
    const L = W.waves.list;
    expect(L.length).toBeGreaterThanOrEqual(3);
    expect(L.length).toBeLessThanOrEqual(4); // the shader takes four
    for (const w of L) {
      expect(w.length).toBeGreaterThanOrEqual(3);
      expect(w.length).toBeLessThanOrEqual(6);
      expect(w.amp).toBeGreaterThan(0);
      expect(w.amp).toBeLessThanOrEqual(0.05);
      expect(w.speed).toBeGreaterThan(0);
      expect(w.speed).toBeLessThan(1); // slow
    }
    // the biggest sit in the 0.02 to 0.05 band; smaller ones only fill in
    expect(Math.max(...L.map((w) => w.amp))).toBeGreaterThanOrEqual(0.02);
    // no two run the same way (no shared crest lines) and no two share a wavelength (no beating into bands)
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++) {
        const da = Math.abs(((L[i].angle - L[j].angle + 540) % 360) - 180);
        expect(Math.min(da, 180 - da), `${i} ${j}`).toBeGreaterThan(20);
        expect(Math.abs(L[i].length - L[j].length)).toBeGreaterThan(0.3);
      }
    expect(W.waves.shore).toBeGreaterThan(0.3); // they ease in from land, never starting at the bank
    expect(W.waves.coverEase).toBeGreaterThan(0.5);
  });

  it('the ripples: two maps of waves 0.2 to 0.8 tiles long, drifting different ways at different speeds', () => {
    const R = W.ripples;
    expect(R.min).toBeGreaterThanOrEqual(0.2);
    expect(R.max).toBeLessThanOrEqual(0.8);
    expect(R.min).toBeLessThan(R.max);
    expect(R.maps.length).toBe(2);
    const [a, b] = R.maps;
    expect(a.size).not.toBe(b.size);
    expect(a.speed).not.toBe(b.speed);
    expect(Math.abs(a.angle - b.angle)).toBeGreaterThan(45);
    for (const m of R.maps) {
      // a map is much longer than its longest waves, so it never reads as a repeating tile
      expect(m.size).toBeGreaterThan(R.max * 2);
      expect(m.speed).toBeGreaterThan(0);
      expect(m.speed).toBeLessThan(0.3);
    }
    expect(R.distort).toBeGreaterThan(0);
    expect(R.distort).toBeLessThan(1);
  });

  it('things standing in the water ring gently, now and then', () => {
    const D = W.disturb;
    expect(D.max).toBeGreaterThan(0);
    expect(D.max).toBeLessThanOrEqual(DISTURB_MAX);
    expect(D.rate).toBeGreaterThan(0);
    expect(D.rate).toBeLessThan(0.5); // a ring every few seconds, not a constant boil
    expect(D.length).toBeGreaterThanOrEqual(W.ripples.min);
    expect(D.length).toBeLessThanOrEqual(W.ripples.max);
    expect(D.reach).toBeGreaterThan(D.length * 2);
    expect(D.strength).toBeGreaterThan(0);
    expect(D.strength).toBeLessThan(0.5);
  });

  it('glints are crisp shapes near a perfect mirror, on the upper part of a wave', () => {
    const G = W.glint;
    expect(G.cut).toBeGreaterThan(0.9);
    expect(G.cut).toBeLessThan(1);
    expect(G.soft).toBeGreaterThan(0);
    expect(G.soft).toBeLessThan(0.02); // a crisp edge (the shader widens it by what changes across a pixel)
    expect(G.cut + G.soft).toBeLessThan(1); // so a glint has an inside, not just an edge
    expect(G.strength).toBeGreaterThan(0);
    expect(G.strength).toBeLessThanOrEqual(2);
  });

  it('the planar reflection is High only, and never on the Steam Deck preset (was water-reflect)', () => {
    expect(LOOK.tiers.high.waterReflect).toBe(true);
    expect(LOOK.tiers.medium.waterReflect).toBe(false);
    expect(LOOK.tiers.low.waterReflect).toBe(false);
    expect(waterReflectOn('high', false)).toBe(true);
    expect(waterReflectOn('medium', false)).toBe(false);
    expect(waterReflectOn('low', false)).toBe(false);
    for (const t of ['high', 'medium', 'low'] as const) expect(waterReflectOn(t, true), t).toBe(false);
  });
});

describe('water colour and Fresnel', () => {
  it('darkens steadily with distance from land, from the shallow colour to the deep one', () => {
    let prev = Infinity;
    for (let d = 0; d <= WATER_ENC; d += 0.25) {
      const [r, g, b] = waterColourAt(d);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(lum).toBeLessThanOrEqual(prev + 1e-9);
      prev = lum;
    }
    const shore = waterColourAt(0);
    const far = waterColourAt(LOOK.water.deepAt + 1);
    expect(shore[1]).toBeGreaterThan(far[1]);
    // far out, blue leads green (blue-teal); by the shore green and blue are close (turquoise)
    expect(far[2]).toBeGreaterThan(far[1]);
  });

  it('is a smooth blend of two colours: the shallow one at the shore, the deep one from deepAt out', () => {
    const lin = (hex: string) => [16, 8, 0].map((s) => Math.pow(((parseInt(hex.slice(1), 16) >> s) & 255) / 255, 2.2));
    const S = lin(LOOK.water.shallow);
    const D = lin(LOOK.water.deep);
    waterColourAt(0).forEach((v, i) => expect(v).toBeCloseTo(S[i], 3));
    waterColourAt(LOOK.water.deepAt).forEach((v, i) => expect(v).toBeCloseTo(D[i], 3));
    waterColourAt(LOOK.water.deepAt + 2).forEach((v, i) => expect(v).toBeCloseTo(D[i], 3));
    // no step anywhere: points a sixteenth of a tile apart barely differ
    for (let d = 0; d < LOOK.water.deepAt; d += 1 / 16) {
      const a = waterColourAt(d);
      const b = waterColourAt(d + 1 / 16);
      for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(0.02);
    }
  });

  it('reflects little looking straight down, more toward the horizon, capped below a mirror', () => {
    const F = LOOK.water.fresnel;
    expect(waterFresnel(1)).toBeCloseTo(F.base, 6);
    expect(waterFresnel(0.5)).toBeGreaterThan(waterFresnel(1));
    expect(waterFresnel(0.1)).toBeGreaterThan(waterFresnel(0.5));
    expect(waterFresnel(0)).toBe(F.max);
    expect(F.max).toBeLessThan(1);
    // the follow camera looks down about 35–50°: the water there mostly shows its own colour
    expect(waterFresnel(Math.sin((40 * Math.PI) / 180))).toBeLessThan(0.15);
  });
});

describe('the large waves', () => {
  const sumAmp = LOOK.water.waves.list.reduce((s, w) => s + w.amp, 0);

  it('only ever lift the surface (the bed never shows through a trough), never more than twice their summed height', () => {
    for (let i = 0; i < 600; i++) {
      const h = waterWaves((i * 7.31) % 61, (i * 3.17) % 47, i * 0.37, 8, []);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(2 * sumAmp + 1e-9);
    }
  });

  it('are still at the waterline and ease in from it', () => {
    for (const t of [0, 3.3, 17]) expect(waterWaves(4.2, 9.1, t, 0, [])).toBe(0);
    let max = 0;
    for (let i = 0; i < 600; i++) max = Math.max(max, waterWaves(i * 0.31, i * 0.17, i * 0.5, 8, []));
    expect(max).toBeGreaterThan(sumAmp);
    // halfway through the ease, half the full lift
    const full = waterWaves(3, 5, 1, 8, []);
    expect(waterWaves(3, 5, 1, LOOK.water.waves.shore / 2, [])).toBeCloseTo(full / 2, 9);
  });

  it('lie flat under a deck built over the water (the jetty) and ease back in round it', () => {
    const deck = [{ x0: 7, z0: 45, x1: 10, z1: 49 }];
    expect(waterCalm(8.5, 47, deck)).toBe(0);
    expect(waterCalm(7, 47, deck)).toBe(0); // its edge
    expect(waterCalm(10 + LOOK.water.waves.coverEase, 47, deck)).toBe(1);
    expect(waterCalm(10 + LOOK.water.waves.coverEase / 2, 47, deck)).toBeCloseTo(0.5, 9);
    for (let i = 0; i < 100; i++) expect(waterWaves(7.5 + (i % 3), 45.5 + (i % 4), i * 0.4, 8, deck)).toBe(0);
    let last = 0;
    for (let x = 10; x <= 12; x += 0.05) {
      const k = waterCalm(x, 47, deck);
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
  });

  it('move slowly: a point rises and falls over seconds, not frames', () => {
    let step = 0;
    for (let i = 0; i < 300; i++) step = Math.max(step, Math.abs(waterWaves(3, 5, i / 60 + 1 / 60, 8, []) - waterWaves(3, 5, i / 60, 8, [])));
    expect(step).toBeLessThan(sumAmp * 0.05);
  });

  it('each runs its own way at its own wavelength and speed (the shader gets a unit direction, wavenumber, height)', () => {
    for (const w of LOOK.water.waves.list) {
      const p = waveParams(w);
      expect(Math.hypot(p.dx, p.dz)).toBeCloseTo(1, 9);
      expect(p.k).toBeCloseTo((2 * Math.PI) / w.length, 9);
      expect(p.omega / p.k).toBeCloseTo(w.speed, 9); // crests travel at `speed` tiles a second
    }
  });

  it("hook into a line the engine's vertex transform still has", () => {
    const src = readFileSync(new URL('../node_modules/playcanvas/build/playcanvas.mjs', import.meta.url), 'utf8');
    expect(src.includes(WAVES_ANCHOR)).toBe(true);
  });
});

describe('the ripple maps', () => {
  const R = LOOK.water.ripples;
  const N = RIPPLE_RES;
  const decode = (d: Uint8Array, i: number) => [(d[i * 4] / 255 - 0.5) * 2 * RIPPLE_RANGE, (d[i * 4 + 1] / 255 - 0.5) * 2 * RIPPLE_RANGE];

  it('are the same for the same seed and differ between the two maps', () => {
    const [a, b] = R.maps;
    const d0 = rippleMapData(a.size, R.min, R.max, a.seed);
    expect(d0).toEqual(rippleMapData(a.size, R.min, R.max, a.seed));
    expect(d0).not.toEqual(rippleMapData(b.size, R.min, R.max, b.seed));
    expect(d0.length).toBe(N * N * 4);
  });

  it('tile seamlessly: across the wrap the slope changes no more than between neighbouring texels inside', () => {
    for (const m of R.maps) {
      const d = rippleMapData(m.size, R.min, R.max, m.seed);
      let inside = 0;
      let wrap = 0;
      for (let y = 0; y < N; y++) {
        const [a0, b0] = decode(d, y * N + N - 1);
        const [a1, b1] = decode(d, y * N);
        wrap = Math.max(wrap, Math.abs(a0 - a1), Math.abs(b0 - b1));
        for (let x = 0; x < N - 1; x += 17) {
          const [c0, e0] = decode(d, y * N + x);
          const [c1, e1] = decode(d, y * N + x + 1);
          inside = Math.max(inside, Math.abs(c0 - c1), Math.abs(e0 - e1));
        }
      }
      expect(wrap).toBeLessThanOrEqual(inside * 1.25 + 0.05);
    }
  });

  it('carry a slope of about 1 per axis (RMS), with blue holding the squared slope for the shader to spread with', () => {
    const m = R.maps[0];
    const d = rippleMapData(m.size, R.min, R.max, m.seed);
    let s2 = 0;
    for (let i = 0; i < N * N; i++) {
      const [a, b] = decode(d, i);
      s2 += a * a + b * b;
      expect(Math.abs(d[i * 4 + 2] / 255 - (a * a + b * b) / (2 * RIPPLE_RANGE * RIPPLE_RANGE))).toBeLessThan(0.02);
    }
    const rms = Math.sqrt(s2 / (N * N) / 2);
    expect(rms).toBeGreaterThan(0.85);
    expect(rms).toBeLessThan(1.15);
  });

  it('drift each toward its own angle, map 1 read in its own turned frame', () => {
    const [a, b] = R.maps;
    const { drift0, drift1, cos, sin } = rippleDrift(a, b);
    // a pattern moving toward `angle` is read at p - v·t: the drift points away from the angle, at speed / size
    const r0 = (a.angle * Math.PI) / 180;
    expect(drift0[0]).toBeCloseTo((-Math.cos(r0) * a.speed) / a.size, 9);
    expect(drift0[1]).toBeCloseTo((-Math.sin(r0) * a.speed) / a.size, 9);
    expect(Math.hypot(drift1[0], drift1[1])).toBeCloseTo(b.speed / b.size, 9);
    const turn = ((b.angle - a.angle) * Math.PI) / 180;
    expect(cos).toBeCloseTo(Math.cos(turn), 9);
    expect(sin).toBeCloseTo(Math.sin(turn), 9);
  });
});

describe('water vertex encoding', () => {
  it('carries the clarity before a restore in blue (the same as now when there is none)', () => {
    expect(encodeWater(1, WATER_CLARITY.clear)[2]).toBe(255);
    expect(encodeWater(1, WATER_CLARITY.clear, WATER_CLARITY.murky)[2]).toBe(Math.round(WATER_CLARITY.murky * 255));
  });

  it("a restore's clarity fade eases from before to now over the restore's own window", () => {
    expect(waterFade(4, 5, 10)).toBe(0); // not started
    expect(waterFade(5, 5, 10)).toBe(0);
    expect(waterFade(10, 5, 10)).toBeCloseTo(0.5, 9);
    expect(waterFade(15, 5, 10)).toBe(1);
    expect(waterFade(99, 5, 10)).toBe(1);
    // eased: slow at the ends, steady through the middle
    expect(waterFade(6, 5, 10)).toBeLessThan(0.1);
    expect(waterFade(14, 5, 10)).toBeGreaterThan(0.9);
    let prev = 0;
    for (let t = 5; t <= 15; t += 0.5) {
      expect(waterFade(t, 5, 10)).toBeGreaterThanOrEqual(prev);
      prev = waterFade(t, 5, 10);
    }
    // no fade (long finished) reads as now
    expect(waterFade(0, -1e6, 1)).toBe(1);
  });

  it('packs distance into red and clarity into green, clamped', () => {
    expect(encodeWater(0, WATER_CLARITY.clear)).toEqual([0, 255, 255, 255]);
    expect(encodeWater(WATER_ENC, WATER_CLARITY.clear)[0]).toBe(255);
    expect(encodeWater(99, 1)[0]).toBe(255);
    expect(encodeWater(-1, 1)[0]).toBe(0);
    expect(encodeWater(WATER_ENC / 2, 1)[0]).toBe(128);
    expect(encodeWater(1, WATER_CLARITY.murky)[1]).toBe(Math.round(WATER_CLARITY.murky * 255));
    expect(WATER_CLARITY.murky).toBeLessThan(WATER_CLARITY.clear);
  });
});

describe('distance to land', () => {
  it('is zero on land, grows away from it, and is capped', () => {
    const land = [{ x: 0, z: 0 }];
    expect(waterDistance(0.5, 0.5, land)).toBe(0);
    expect(waterDistance(1, 0.5, land)).toBe(0);
    expect(waterDistance(2, 0.5, land)).toBeCloseTo(1, 9);
    expect(waterDistance(3, 3, land)).toBeCloseTo(Math.hypot(2, 2), 9);
    expect(waterDistance(100, 0, land)).toBe(WATER_ENC);
    expect(waterDistance(5, 5, [])).toBe(WATER_ENC);
  });

  it('follows a rounded corner: the cut-away corner is water, at the arc distance', () => {
    // corner order as CORNERS: the corner at +x,+z is whichever index it is, so cut all four
    const R = 0.4;
    const land = [{ x: 0, z: 0, cut: [R, R, R, R] }];
    const square = waterDistance(1.05, 1.05, [{ x: 0, z: 0 }]);
    const round = waterDistance(1.05, 1.05, land);
    expect(round).toBeGreaterThan(square);
    // the square's own corner point is now off the land, by the arc's gap
    const c = 0.5 + (0.5 - R);
    expect(waterDistance(1, 1, land)).toBeCloseTo(Math.hypot(1 - c, 1 - c) - R, 9);
    // the middle of an edge is unchanged
    expect(waterDistance(1.5, 0.5, land)).toBeCloseTo(0.5, 9);
  });
});

describe('planar reflection clip plane', () => {
  it('puts the water plane on the near plane and keeps what is above it', () => {
    // a camera above the water, looking down at it
    const eye = new pc.Vec3(0, 8, 10);
    const world = new pc.Mat4().setLookAt(eye, new pc.Vec3(0, 0, 0), pc.Vec3.UP);
    // the mirrored camera (y = 0 plane)
    const M = new pc.Mat4();
    M.data[5] = -1;
    const viewInv = new pc.Mat4().mul2(M, world);
    const view = viewInv.clone().invert();
    const proj = new pc.Mat4().setPerspective(20, 16 / 9, 0.5, 140);
    obliqueClip(proj, view, 0);
    const vp = new pc.Mat4().mul2(proj, view);
    const ndcZ = (p: pc.Vec3) => {
      const v = new pc.Vec4(p.x, p.y, p.z, 1);
      vp.transformVec4(v, v);
      return v.z / v.w;
    };
    // points on the plane, in front of the camera, land on the near plane (z = -1)
    for (const p of [new pc.Vec3(0, 0, 0), new pc.Vec3(2, 0, -3), new pc.Vec3(-1.5, 0, 2)]) expect(ndcZ(p)).toBeCloseTo(-1, 4);
    // above the water is inside the frustum, below it is clipped
    expect(ndcZ(new pc.Vec3(0, 1, 0))).toBeGreaterThan(-1);
    expect(ndcZ(new pc.Vec3(0, 1, 0))).toBeLessThan(1);
    expect(ndcZ(new pc.Vec3(0, -0.5, 0))).toBeLessThan(-1);
  });
});

describe('water material', () => {
  const param = (name: string) => (waterMaterial().getParameter(name) as { data?: unknown } | undefined)?.data as number[];

  it('is one shared material', () => {
    expect(waterMaterial()).toBe(waterMaterial());
    expect(waterMaterial().name).toBe('water');
  });

  it('takes the night and turns the reflection on and off with the frame', () => {
    const tex = {} as pc.Texture;
    const vp = new pc.Mat4();
    setWaterFrame({ time: 1, cam: { x: 0, y: 5, z: 0 }, night: 0, skyLow: [0.9, 0.9, 0.85], skyHigh: [0.5, 0.7, 0.95] });
    expect(param('uWaterMisc')[0]).toBeCloseTo(LOOK.water.caustics, 9); // caustics by day
    expect(param('uWaterMisc')[1]).toBe(0);
    expect(param('uWaterRefl')[0]).toBe(0); // no reflection given: off
    setWaterFrame({ time: 1, cam: { x: 0, y: 5, z: 0 }, night: 1, skyLow: [0.1, 0.14, 0.3], skyHigh: [0.05, 0.08, 0.22], reflect: { tex, viewProj: vp, planeY: 0.2 } });
    expect(param('uWaterMisc')[0]).toBe(0); // no caustics at night
    expect(param('uWaterMisc')[1]).toBe(1);
    expect(param('uWaterMisc')[2]).toBe(LOOK.water.nightAlbedo);
    expect(param('uWaterRefl')).toEqual([LOOK.water.reflect.strength, LOOK.water.reflect.distort, 0.2, 0]);
    // sky colours go in linear
    expect(param('uWaterSkyLow')[2]).toBeCloseTo(Math.pow(0.3, 2.2), 5);
    setWaterFrame({ time: 1, cam: { x: 0, y: 5, z: 0 }, night: 0, skyLow: [0.9, 0.9, 0.85], skyHigh: [0.5, 0.7, 0.95] });
    expect(param('uWaterRefl')[0]).toBe(0);
  });

  it('hands the shader the look values for the waves, the ripples, the rings and the glints', () => {
    const W = LOOK.water;
    W.waves.list.forEach((w, i) => {
      const p = waveParams(w);
      expect(Array.from(param(`uWaterWave${i}`))).toEqual([p.dx, p.dz, p.k, p.amp].map((v) => expect.closeTo(v, 6)));
      expect(param('uWaterWaveW')[i]).toBeCloseTo(p.omega, 6);
      expect(param('uWaterWaveP')[i]).toBeCloseTo(p.phase, 6);
    });
    expect(param('uWaterWaveE')[0]).toBe(W.waves.shore);
    expect(param('uWaterWaveE')[3]).toBe(W.waves.coverEase);
    expect(param('uWaterRipA')[0]).toBeCloseTo(1 / W.ripples.maps[0].size, 9);
    expect(param('uWaterRipB')[0]).toBeCloseTo(1 / W.ripples.maps[1].size, 9);
    expect(param('uWaterRipC')[0]).toBe(W.ripples.strength);
    expect(param('uWaterRipC')[1]).toBe(W.ripples.distort);
    expect(param('uWaterRipC')[3]).toBe(RIPPLE_RANGE);
    expect(param('uWaterObsW')).toEqual([W.disturb.width, W.disturb.strength]);
    expect(param('uWaterGlint')).toEqual([W.glint.cut, W.glint.soft, W.glint.strength]);
    expect(param('uWaterDepth')[1]).toBe(W.deepAt);
  });

  it('rings round the disturbers nearest where the camera looks, and lays the swell flat under the nearest decks', () => {
    resetWaterDisturbers();
    const frame = { time: 1, cam: { x: 0, y: 5, z: 0 }, night: 0, skyLow: [0.5, 0.5, 0.6] as [number, number, number], skyHigh: [0.3, 0.4, 0.7] as [number, number, number] };
    setWaterDisturbers('near', [{ x: 1, z: 1, r: 0.1 }]);
    setWaterDisturbers('far', Array.from({ length: 30 }, (_, i) => ({ x: 50 + i, z: 50, r: 0.2, strength: 0.5 })));
    setWaterCovers('deck', [{ x0: 0, z0: 0, x1: 2, z1: 3 }]);
    setWaterFrame({ ...frame, focus: { x: 0, z: 0 } });
    expect(param('uWaterObsK')[0]).toBe(Math.min(DISTURB_MAX, LOOK.water.disturb.max));
    expect(Array.from(param('uWaterObs[0]')).slice(0, 4)).toEqual([1, 1, expect.closeTo(0.1, 6), 1]); // the nearest first
    expect(param('uWaterCoverN') as unknown as number).toBe(1);
    expect(Array.from(param('uWaterCover[0]')).slice(0, 4)).toEqual([0, 0, 2, 3]);
    expect(param('uWaterCover[0]').length).toBe(COVER_MAX * 4);
    // moving the focus picks again: now the far row is nearest
    setWaterFrame({ ...frame, focus: { x: 60, z: 50 } });
    expect(Array.from(param('uWaterObs[0]')).slice(0, 2)).toEqual([60, 50]);
    // the list changing picks again too, without the focus moving
    resetWaterDisturbers();
    setWaterFrame({ ...frame, focus: { x: 60, z: 50 } });
    expect(param('uWaterObsK')[0]).toBe(0);
    expect(param('uWaterCoverN') as unknown as number).toBe(0);
  });

  it("glints take the sun's or moon's direction and colour, in linear, scaled by its share of full light", () => {
    const frame = { time: 1, cam: { x: 0, y: 5, z: 0 }, night: 0, skyLow: [0.5, 0.5, 0.6] as [number, number, number], skyHigh: [0.3, 0.4, 0.7] as [number, number, number] };
    setWaterFrame({ ...frame, light: { toLight: new pc.Vec3(0.6, 0.8, 0), color: new pc.Color(1, 0.8, 0.5), share: 0.5 } });
    expect(Array.from(param('uWaterLightDir'))).toEqual([expect.closeTo(0.6, 6), expect.closeTo(0.8, 6), 0]);
    const col = Array.from(param('uWaterLightCol'));
    expect(col[0]).toBeCloseTo(0.5, 6);
    expect(col[1]).toBeCloseTo(Math.pow(0.8, 2.2) * 0.5, 6);
    expect(col[2]).toBeCloseTo(Math.pow(0.5, 2.2) * 0.5, 6);
    // no light given: no glints
    setWaterFrame(frame);
    expect(Array.from(param('uWaterLightCol'))).toEqual([0, 0, 0]);
  });

  it('by day the water is untouched by the night; dusk sits in between; night needs no tier (was water-night)', () => {
    const at = (night: number) => setWaterFrame({ time: 1, cam: { x: 0, y: 5, z: 0 }, night, skyLow: [0.5, 0.5, 0.6], skyHigh: [0.3, 0.4, 0.7] });
    at(0);
    expect(param('uWaterMisc')[1]).toBe(0);
    expect(param('uWaterMisc')[0]).toBeCloseTo(LOOK.water.caustics, 9);
    at(0.5);
    expect(param('uWaterMisc')[1]).toBe(0.5);
    expect(param('uWaterMisc')[0]).toBeCloseTo(LOOK.water.caustics * 0.5, 9);
    at(1);
    expect(param('uWaterMisc')[1]).toBe(1);
    // out of range clamps
    at(3);
    expect(param('uWaterMisc')[1]).toBe(1);
    at(0);
  });

  it('the shader tints by the same navy LOOK names, in linear', () => {
    const n = param('uWaterNight');
    const c = parseInt(LOOK.water.night.slice(1), 16);
    const lin = (v: number) => Math.pow(v / 255, 2.2);
    expect(n[0]).toBeCloseTo(lin((c >> 16) & 255), 3);
    expect(n[1]).toBeCloseTo(lin((c >> 8) & 255), 3);
    expect(n[2]).toBeCloseTo(lin(c & 255), 3);
    expect(param('uWaterAmbient') as unknown as number).toBe(LOOK.water.ambient);
  });
});

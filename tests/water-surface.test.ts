import * as pc from 'playcanvas';
import { describe, expect, it } from 'vitest';
import { LOOK } from '../src/data/look';
import { waterDistance } from '../src/rendering/ChunkRenderer';
import { obliqueClip } from '../src/rendering/WaterReflection';
import { readFileSync } from 'node:fs';
import { SWELL_ANCHOR, WATER_CLARITY, WATER_ENC, encodeWater, setWaterFrame, waterColourAt, waterFade, waterFresnel, waterMaterial, waterReflectOn, waterSwell } from '../src/rendering/WaterSurface';

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

  it('shallows are turquoise and the deep is a bluer, darker teal', () => {
    const s = hsv(W.shallow);
    const m = hsv(W.mid);
    const d = hsv(W.deep);
    expect(s.h).toBeGreaterThan(165);
    expect(s.h).toBeLessThan(185);
    expect(d.h).toBeGreaterThan(185);
    expect(d.h).toBeLessThan(215);
    expect(m.h).toBeGreaterThan(s.h);
    expect(d.h).toBeGreaterThan(m.h);
    expect(d.v).toBeLessThan(m.v);
    expect(m.v).toBeLessThan(s.v);
  });

  it('no fluorescent cyan: every water colour stays well short of full saturation at full brightness', () => {
    for (const c of [W.shallow, W.mid, W.deep, W.murky]) {
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

  it('far ripples fade only once they are truly too fine to draw, and their variance roughens the highlight (no pixel sparkle)', () => {
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
    expect(aa[0]).toBe(A.variance);
    expect(aa[1]).toBeCloseTo(1 / A.fadeFrom, 9);
    expect(aa[2]).toBeCloseTo(1 / A.fadeTo, 9);
  });

  it('distances and strengths sit in sensible ranges', () => {
    expect(W.midAt).toBeGreaterThan(0);
    expect(W.deepAt).toBeGreaterThan(W.midAt);
    expect(W.deepAt).toBeLessThanOrEqual(WATER_ENC);
    expect(W.ripple.strength).toBeGreaterThan(0);
    expect(W.ripple.strength).toBeLessThan(0.3); // subtle, not choppy
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

  it('the swell is gentle and slow, and long next to the ripples', () => {
    const S = W.swell;
    expect(S.height).toBeGreaterThan(0);
    expect(S.height * 3.2).toBeLessThanOrEqual(0.1); // its highest crest stays a tenth of a tile: a swell, not a storm
    expect(S.length).toBeGreaterThanOrEqual(4 * W.ripple.scale);
    expect(S.speed).toBeGreaterThan(0);
    expect(S.speed).toBeLessThan(1);
    expect(S.shore).toBeGreaterThan(0.3); // it eases in from land, never starting at the bank
  });

  it('crests are lighter than troughs, within a calm range, and only the very tops are capped', () => {
    const C = W.crest;
    expect(C.trough).toBeGreaterThanOrEqual(0.75);
    expect(C.trough).toBeLessThan(1);
    expect(C.crest).toBeGreaterThan(1);
    expect(C.crest).toBeLessThanOrEqual(1.2);
    expect(C.cap).toBeGreaterThan(0.5);
    expect(C.cap).toBeLessThan(1);
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
    expect(G.crest).toBeGreaterThanOrEqual(-1);
    expect(G.crest).toBeLessThan(1);
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

describe('the swell', () => {
  it('only ever lifts the surface (the bed never shows through a trough)', () => {
    for (let i = 0; i < 400; i++) {
      const x = (i * 7.31) % 61;
      const z = (i * 3.17) % 47;
      expect(waterSwell(x, z, i * 0.37, 8)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is still at the shore and under the jetty, and full height out at sea', () => {
    for (const t of [0, 3.3, 17]) {
      expect(waterSwell(4.2, 9.1, t, 0)).toBe(0);
      expect(waterSwell(4.2, 9.1, t, 0.3)).toBe(0);
    }
    let max = 0;
    for (let i = 0; i < 400; i++) max = Math.max(max, waterSwell(i * 0.31, i * 0.17, i * 0.5, 8));
    expect(max).toBeGreaterThan(LOOK.water.swell.height * 2);
    expect(max).toBeLessThanOrEqual(LOOK.water.swell.height * 3.2 + 1e-9);
  });

  it('moves slowly: a point rises and falls over seconds, not frames', () => {
    // its biggest change across one frame at 60 fps is a sliver of its height
    let step = 0;
    for (let i = 0; i < 200; i++) step = Math.max(step, Math.abs(waterSwell(3, 5, i / 60 + 1 / 60, 8) - waterSwell(3, 5, i / 60, 8)));
    expect(step).toBeLessThan(LOOK.water.swell.height * 0.05);
  });

  it("hooks into a line the engine's vertex transform still has", () => {
    const src = readFileSync(new URL('../node_modules/playcanvas/build/playcanvas.mjs', import.meta.url), 'utf8');
    expect(src.includes(SWELL_ANCHOR)).toBe(true);
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

  it('hands the shader the look values for the swell, the crests and the glints', () => {
    const W = LOOK.water;
    expect(param('uWaterSwell')).toEqual([W.swell.height, W.swell.length, W.swell.speed, W.swell.shore]);
    expect(param('uWaterCrest')).toEqual([W.crest.trough, W.crest.crest, W.crest.cap]);
    expect(param('uWaterGlint')).toEqual([W.glint.cut, W.glint.soft, W.glint.strength, W.glint.crest]);
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

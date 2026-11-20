import { describe, expect, it } from 'vitest';
import { FARMLAND_FADE, FARMLAND_STATES, farmlandGeo, paintFarmland, type FarmlandState } from '../src/rendering/FarmlandArt';

/**
 * #466: the farmland ground. Its three states must read apart at a glance (in lightness, not only hue, like every
 * ground state in docs/art/palette.md), the texture must tile without a seam, and a field must fade into the ground
 * only where there is no farmland beyond, so it reads as one patch.
 */
const N = 128;
const paint = (s: FarmlandState) => {
  const px = new Uint8ClampedArray(N * N * 4);
  paintFarmland(px, s, N);
  return px;
};
const lum = (px: Uint8ClampedArray, i: number) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
const meanLum = (px: Uint8ClampedArray) => {
  let s = 0;
  for (let i = 0; i < px.length; i += 4) s += lum(px, i);
  return s / (px.length / 4);
};

describe('#466: farmland ground art', () => {
  const img = Object.fromEntries(FARMLAND_STATES.map((s) => [s, paint(s)])) as Record<FarmlandState, Uint8ClampedArray>;

  it('dry, watered and fertilised differ clearly in lightness: dry palest, watered darkest', () => {
    const L = Object.fromEntries(FARMLAND_STATES.map((s) => [s, meanLum(img[s])])) as Record<FarmlandState, number>;
    expect(L.dry - L.fertilised).toBeGreaterThan(15);
    expect(L.fertilised - L.watered).toBeGreaterThan(4);
    // all are soil: dark-ish and warm (red over blue), around the palette's #5f4733
    for (const s of FARMLAND_STATES) {
      expect(L[s]).toBeGreaterThan(30);
      expect(L[s]).toBeLessThan(150);
    }
  });

  it('fertilised has compost flecks: more very dark specks than the other states', () => {
    const dark = (px: Uint8ClampedArray) => {
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (lum(px, i) < 36) n++;
      return n;
    };
    expect(dark(img.fertilised)).toBeGreaterThan(dark(img.dry) * 2);
  });

  it('tiles without a seam: the wrap from the last column to the first is like any neighbouring pair', () => {
    for (const s of FARMLAND_STATES) {
      const px = img[s];
      let wrap = 0, inner = 0;
      for (let y = 0; y < N; y++) {
        wrap += Math.abs(lum(px, (y * N + N - 1) * 4) - lum(px, y * N * 4));
        inner += Math.abs(lum(px, (y * N + N / 2) * 4) - lum(px, (y * N + N / 2 - 1) * 4));
        const top = Math.abs(lum(px, ((N - 1) * N + y) * 4) - lum(px, y * 4));
        wrap += top;
        inner += Math.abs(lum(px, ((N / 2) * N + y) * 4) - lum(px, ((N / 2 - 1) * N + y) * 4));
      }
      expect(wrap, s).toBeLessThan(inner * 2.5 + N * 4);
    }
  });

  it('a lone tile fades out past every edge; inside it is solid', () => {
    const g = farmlandGeo([{ x: 0, z: 0, y: 0, state: 'dry' }]).dry;
    const verts = g.pos.length / 3;
    let outside = 0;
    for (let i = 0; i < verts; i++) {
      const x = g.pos[i * 3], z = g.pos[i * 3 + 2], a = g.col[i * 4 + 3];
      const past = Math.max(-x, x - 1, -z, z - 1);
      if (past >= FARMLAND_FADE - 1e-6) {
        expect(a, `faded out at ${x},${z}`).toBe(0);
        outside++;
      }
      if (x > 0.2 && x < 0.8 && z > 0.2 && z < 0.8) expect(a).toBe(255);
    }
    expect(outside).toBeGreaterThan(0);
  });

  it('two tiles side by side join with no band between them, and the texture runs on across the join', () => {
    const g = farmlandGeo([
      { x: 0, z: 0, y: 0, state: 'watered' },
      { x: 1, z: 0, y: 0, state: 'watered' },
    ]).watered;
    for (let i = 0; i < g.pos.length / 3; i++) {
      const x = g.pos[i * 3], z = g.pos[i * 3 + 2];
      // no vertex reaches into the other tile's space from either side, and the join is fully opaque mid-edge
      if (Math.abs(x - 1) < 1e-6 && z > 0.2 && z < 0.8) expect(g.col[i * 4 + 3]).toBe(255);
      expect(g.uv[i * 2]).toBeCloseTo(x / 3, 6); // world-space texture coordinates
    }
    const xs = new Set<number>();
    for (let i = 0; i < g.pos.length / 3; i++) xs.add(+g.pos[i * 3].toFixed(3));
    expect(xs.has(1 - FARMLAND_FADE) || xs.has(+(0 + 1 + FARMLAND_FADE).toFixed(3))).toBe(false);
  });

  it('each state gets its own mesh, so a field can show all three', () => {
    const g = farmlandGeo([
      { x: 0, z: 0, y: 0, state: 'dry' },
      { x: 1, z: 0, y: 0, state: 'watered' },
      { x: 2, z: 0, y: 0, state: 'fertilised' },
    ]);
    for (const s of FARMLAND_STATES) expect(g[s].idx.length, s).toBeGreaterThan(0);
  });
});

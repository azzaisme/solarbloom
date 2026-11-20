import * as pc from 'playcanvas';
import { clamp01, makeNoise, mix, rng, smooth, type RGB } from './GroundTex';

/**
 * Farmland ground (#466, for #517's tilled fields): painted tilled soil on restored earth or grass, in three states
 * you can tell apart at a glance:
 *
 *  - `dry`: paler, dusty furrow crests, hairline cracks, little moss
 *  - `watered`: darker and damp, water lying in the furrow bottoms, a slight sheen (a glossier material)
 *  - `fertilised`: rich dark soil with flecks of compost and straw, and more moss
 *
 * The base is the palette's tilled soil (`PALETTE.ground` prepared plot) with moss dots (docs/art/palette.md). The furrows run along world X
 * (4 a metre) and the texture is laid in world space like the other painted ground (GroundTex), so a field runs
 * on with no seams between tiles. Where a side of a tile is not farmland the soil fades into the ground around it over
 * a ragged band, so a field reads as one patch rather than squares.
 *
 * The art only: which tiles are farmland, and their state, is #517's (the sim). `FarmlandView.set` takes the tiles.
 */

export type FarmlandState = 'dry' | 'watered' | 'fertilised';
export const FARMLAND_STATES: FarmlandState[] = ['dry', 'watered', 'fertilised'];

/** World metres one copy of the texture covers (12 furrows). */
export const FARMLAND_TILE_M = 3;
/** How far (m) the soil fades out past an edge that has no farmland beyond it. */
export const FARMLAND_FADE = 0.28;
/** Height over the tile top: just over the painted ground (GroundTex sits at +0.086). */
export const FARMLAND_LIFT = 0.094;
const SIZE = 512;
const FURROWS = 12; // per texture: 4 a metre

const SOIL: RGB = [95, 71, 51]; // #5f4733
const MOSS: RGB = [104, 128, 74]; // a muted moss, so the dots read as moss on soil, not confetti

/** Paints one state into an RGBA buffer of SIZE × SIZE (seamless both ways). Pure, so tests can read it. */
export function paintFarmland(px: Uint8ClampedArray, state: FarmlandState, size = SIZE) {
  const n1 = makeNoise(71), n2 = makeNoise(83), n3 = makeNoise(97);
  const R = rng(state === 'dry' ? 3 : state === 'watered' ? 5 : 7);
  // compost flecks and straw (fertilised), clods (all): scattered points, wrapped
  const flecks: { x: number; y: number; r: number; k: number }[] = [];
  const nFleck = state === 'fertilised' ? 900 : 260;
  for (let i = 0; i < nFleck; i++) flecks.push({ x: R(), y: R(), r: 0.0025 + R() * R() * 0.006, k: R() });
  const G = 14; // dry cracks: a periodic Voronoi like the dead earth's
  const seeds: [number, number][] = [];
  for (let i = 0; i < G * G; i++) seeds.push([((i % G) + R()) / G, (Math.floor(i / G) + R()) / G]);

  const tone: Record<FarmlandState, { base: RGB; crest: RGB; trough: RGB }> = {
    dry: { base: mix(SOIL, [158, 126, 92], 0.42), crest: [184, 154, 116], trough: mix(SOIL, [120, 92, 66], 0.5) },
    watered: { base: [64, 46, 33], crest: [86, 64, 46], trough: [40, 30, 24] },
    fertilised: { base: [78, 55, 37], crest: [104, 76, 52], trough: [52, 37, 26] },
  };
  const t = tone[state];
  const mossAmount = state === 'dry' ? 0.25 : state === 'watered' ? 0.6 : 1;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      // furrows: ridges across v, wobbling a little so they look hoed by hand
      const wob = (n1(u, v, 4) - 0.5) * 0.35 + (n2(u, v, 9) - 0.5) * 0.12;
      const ph = (v * FURROWS + wob) * Math.PI * 2;
      const ridge = Math.sin(ph); // 1 crest, -1 trough
      const lit = Math.cos(ph); // the side facing the light (upper left) is brighter
      let c = mix(t.trough, t.base, smooth(-1, 0.1, ridge));
      c = mix(c, t.crest, smooth(0.35, 1, ridge) * 0.55 + smooth(0.2, 1, lit) * 0.12);
      // tonal drift, so a field isn't flat
      const drift = n3(u, v, 3) * 0.6 + n1(u, v, 7) * 0.4;
      c = mix(c, mix(c, [0, 0, 0], 0.25), smooth(0.55, 0.9, drift) * 0.5);
      // clods: small lumps on the crests
      const clod = n2(u, v, 48);
      c = mix(c, t.crest, smooth(0.7, 0.85, clod) * smooth(0, 0.8, ridge) * 0.5);
      if (state === 'dry') {
        // hairline cracks across the crests
        let d1 = 9, d2 = 9;
        const gx = Math.floor(u * G), gy = Math.floor(v * G);
        for (let k = 0; k < 9; k++) {
          const s = seeds[((((gy + Math.floor(k / 3) - 1) % G) + G) % G) * G + ((((gx + (k % 3) - 1) % G) + G) % G)];
          let dx = u - s[0], dy = v - s[1];
          dx -= Math.round(dx);
          dy -= Math.round(dy);
          const dd = dx * dx + dy * dy;
          if (dd < d1) {
            d2 = d1;
            d1 = dd;
          } else if (dd < d2) d2 = dd;
        }
        const edge = Math.sqrt(d2) - Math.sqrt(d1);
        c = mix(c, [92, 66, 46], smooth(0.004, 0.0012, edge) * smooth(-0.2, 0.6, ridge) * 0.7);
      }
      if (state === 'watered') {
        // water lying in the furrow bottoms: dark, a little blue, with a pale glint on its far edge
        const wet = smooth(-0.55, -0.95, ridge) * smooth(0.3, 0.6, n1(u, v, 6));
        c = mix(c, [44, 50, 60], wet * 0.8);
        c = mix(c, [150, 170, 190], wet * smooth(0.6, 1, -lit) * 0.25);
      }
      // compost flecks and straw (fertilised), a few pale grains otherwise
      for (const f of flecks) {
        let dx = u - f.x, dy = v - f.y;
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        if (Math.abs(dx) > f.r * 3 || Math.abs(dy) > f.r) continue;
        const straw = state === 'fertilised' && f.k > 0.78;
        const d = straw ? Math.hypot(dx / 3, dy) : Math.hypot(dx, dy);
        if (d > f.r) continue;
        const col: RGB = straw ? [196, 162, 96] : state === 'fertilised' ? [38, 28, 20] : t.crest;
        c = mix(c, col, smooth(1, 0.5, d / f.r) * (state === 'fertilised' ? 0.9 : 0.4));
      }
      // moss dots, clustered, on the crests
      const mossy = smooth(0.66, 0.78, n3(u, v, 5)) * smooth(0.8, 0.9, n2(u, v, 64)) * mossAmount;
      c = mix(c, MOSS, mossy * smooth(-0.3, 0.5, ridge) * 0.75);
      const g = (n1(u, v, 128) - 0.5) * 9; // grit
      const i = (y * size + x) * 4;
      px[i] = c[0] + g;
      px[i + 1] = c[1] + g * 0.85;
      px[i + 2] = c[2] + g * 0.7;
      px[i + 3] = 255;
    }
}

// ───────────── geometry ─────────────

export interface FarmlandTile {
  x: number;
  z: number;
  /** the tile top (world y) */
  y: number;
  state: FarmlandState;
}

export interface FarmlandGeo {
  pos: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

/** A smooth value 0…1 at a world point, the same from either tile that shares it (so fades meet without seams). */
function hash01(x: number, z: number) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
function jitter(x: number, z: number) {
  // smooth over ~0.5 m: bilinear between hashed lattice points
  const fx = x * 2, fz = z * 2;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const tx = fx - x0, tz = fz - z0;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const a = hash01(x0, z0), b = hash01(x0 + 1, z0), c = hash01(x0, z0 + 1), d = hash01(x0 + 1, z0 + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

/**
 * The meshes for a set of farmland tiles, one per state. Each tile is a small grid; a side with no farmland tile
 * beyond it grows a band that fades to nothing over FARMLAND_FADE (ragged: the band's width wanders with a smooth
 * world-space noise), and the soil inside thins a touch toward that edge. Between two farmland tiles there is no band
 * and the texture runs straight on. Vertex alpha carries the fade.
 */
export function farmlandGeo(tiles: FarmlandTile[]): Record<FarmlandState, FarmlandGeo> {
  const empty = (): FarmlandGeo => ({ pos: [], uv: [], col: [], idx: [] });
  const out: Record<FarmlandState, FarmlandGeo> = { dry: empty(), watered: empty(), fertilised: empty() };
  const at = new Set(tiles.map((t) => `${t.x},${t.z}`));
  const has = (x: number, z: number) => at.has(`${x},${z}`);
  const b = FARMLAND_FADE;
  for (const t of tiles) {
    const g = out[t.state];
    const W = !has(t.x - 1, t.z), E = !has(t.x + 1, t.z), N = !has(t.x, t.z - 1), S = !has(t.x, t.z + 1);
    const xs = [...(W ? [-b] : []), 0, 0.25, 0.5, 0.75, 1, ...(E ? [1 + b] : [])];
    const zs = [...(N ? [-b] : []), 0, 0.25, 0.5, 0.75, 1, ...(S ? [1 + b] : [])];
    const base = g.pos.length / 3;
    for (const lz of zs)
      for (const lx of xs) {
        const wx = t.x + lx, wz = t.z + lz;
        // signed distance past the open edges (positive outside the field, negative inside it)
        const past = Math.max(W ? -lx : -9, E ? lx - 1 : -9, N ? -lz : -9, S ? lz - 1 : -9);
        const j = jitter(wx, wz);
        const reach = b * (0.45 + 0.55 * j); // where it has faded right out
        const alpha = past <= -9 ? 1 : 1 - smooth(-0.08 - 0.1 * j, reach, past);
        g.pos.push(wx, t.y + FARMLAND_LIFT, wz);
        g.uv.push(wx / FARMLAND_TILE_M, wz / FARMLAND_TILE_M);
        g.col.push(255, 255, 255, Math.round(clamp01(alpha) * 255));
      }
    const nx = xs.length;
    for (let r = 0; r < zs.length - 1; r++)
      for (let c = 0; c < nx - 1; c++) {
        const i = base + r * nx + c;
        g.idx.push(i, i + nx, i + 1, i + 1, i + nx, i + nx + 1);
      }
  }
  return out;
}

// ───────────── material and view ─────────────

function canvasOf(state: FarmlandState): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  paintFarmland(img.data, state);
  ctx.putImageData(img, 0, 0);
  return cv;
}

const materials = new Map<FarmlandState, pc.StandardMaterial>();

export function farmlandMaterial(device: pc.GraphicsDevice, state: FarmlandState): pc.StandardMaterial {
  const have = materials.get(state);
  if (have) return have;
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(1, 1, 1);
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = state === 'watered' ? 0.55 : 0.12; // damp soil has a slight sheen
  m.opacityVertexColor = true;
  m.opacityVertexColorChannel = 'a';
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  const tex = new pc.Texture(device, {
    name: `farmland-${state}`,
    mipmaps: true,
    anisotropy: 8,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
  });
  tex.setSource(canvasOf(state));
  m.diffuseMap = tex;
  m.update();
  materials.set(state, m);
  return m;
}

/**
 * The farmland in the world: one mesh per state. Empty until the farm (#517) calls `set` with its tiles; call it
 * again whenever a tile is tilled, removed or changes state (it rebuilds; fields are small).
 */
export class FarmlandView {
  readonly root: pc.Entity;
  private parts: pc.Entity[] = [];
  tiles: FarmlandTile[] = [];

  constructor(
    parent: pc.Entity,
    private device: pc.GraphicsDevice,
  ) {
    this.root = new pc.Entity('farmland');
    parent.addChild(this.root);
  }

  set(tiles: FarmlandTile[]) {
    this.tiles = tiles.slice();
    for (const p of this.parts) p.destroy();
    this.parts = [];
    const geo = farmlandGeo(tiles);
    for (const state of FARMLAND_STATES) {
      const g = geo[state];
      if (!g.idx.length) continue;
      const mesh = new pc.Mesh(this.device);
      mesh.setPositions(g.pos);
      mesh.setNormals(g.pos.map((_, i) => (i % 3 === 1 ? 1 : 0)));
      mesh.setUvs(0, g.uv);
      mesh.setColors32(g.col);
      mesh.setIndices(g.idx);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      const e = new pc.Entity(`farmland-${state}`);
      e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, farmlandMaterial(this.device, state))], castShadows: false, receiveShadows: true });
      this.root.addChild(e);
      this.parts.push(e);
    }
  }
}

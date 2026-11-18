import * as pc from 'playcanvas';

/**
 * Painted ground textures (owner, 18 Nov 2026): tiling images laid over Old City ground tiles in world space, so
 * the ground runs on without seams from tile to tile and chunk to chunk, instead of flat slabs with drawn-on cracks.
 *
 *  - `sand`: the beach's dead sand (warm gold, wind ripples, pale pebbles)
 *  - `dead-earth`: dead grass, leaf litter and clay (dry red-brown earth, cracked in patches, small stones)
 *
 * Each is painted procedurally at startup (512², seamless, no download), in the hand-painted look of the owner's
 * reference images. A file in `assets/raw/textures/` named `<name>.png`, `.webp` or `.jpg` replaces the painted
 * one. A chunk draws one extra mesh per texture over the slabs of the tiles that use it; the vertex colour tints it.
 */

const FILES = import.meta.glob('../../assets/raw/textures/*.{png,webp,jpg}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export type GroundTexName = 'sand' | 'dead-earth';
export const GROUND_TEXTURES: GroundTexName[] = ['sand', 'dead-earth'];

/** World metres one copy of each texture covers. */
const TILE_M: Record<GroundTexName, number> = { sand: 5, 'dead-earth': 5 };
const SIZE = 512;

function urlOf(name: GroundTexName): string | undefined {
  for (const [path, url] of Object.entries(FILES)) if (path.split('/').pop()!.replace(/\.(png|webp|jpg)$/, '') === name) return url;
  return undefined;
}

// ───────────── painting ─────────────

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Periodic value noise: `p` lattice cells across the texture, smooth, 0…1. */
function makeNoise(seed: number) {
  const R = rng(seed);
  const perm = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) perm[i] = R();
  const at = (x: number, y: number, p: number) => perm[((((x % p) + p) % p) * 61 + (((y % p) + p) % p) * 17 + p * 7) & 4095];
  return (u: number, v: number, p: number) => {
    const fx = u * p, fy = v * p;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0, p), b = at(x0 + 1, y0, p), c = at(x0, y0 + 1, p), d = at(x0 + 1, y0 + 1, p);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

interface Stone { x: number; y: number; r: number; tone: number; sq: number; rot: number }

/** Scattered stones, in clusters, wrapped. Returned for the per-pixel pass (lit from the upper left). */
function stones(R: () => number, n: number, rMin: number, rMax: number): Stone[] {
  const out: Stone[] = [];
  while (out.length < n) {
    const cx = R(), cy = R();
    const k = 1 + Math.floor(R() * 3);
    for (let i = 0; i < k && out.length < n; i++) out.push({ x: cx + (R() - 0.5) * 0.05, y: cy + (R() - 0.5) * 0.05, r: (rMin + (rMax - rMin) * R() * R()) * (i ? 0.6 : 1), tone: R(), sq: 0.7 + R() * 0.5, rot: R() * 3.14 });
  }
  return out;
}

/** Shades `c` at (u, v) for the stones: a contact shadow to the lower right, a faceted body lit from the upper left. */
function stonePass(c: RGB, u: number, v: number, list: Stone[], body: RGB, light: RGB, dark: RGB): RGB {
  for (const s of list) {
    let dx = u - s.x, dy = v - s.y;
    dx -= Math.round(dx);
    dy -= Math.round(dy);
    if (Math.abs(dx) > s.r * 2.2 || Math.abs(dy) > s.r * 2.2) continue;
    // contact shadow
    const sh = Math.hypot(dx - s.r * 0.35, dy - s.r * 0.4) / (s.r * 1.25);
    if (sh < 1) c = mix(c, dark, (1 - sh) * 0.45);
    // a rounded, slightly squared-off pebble
    const cr = Math.cos(s.rot), sr = Math.sin(s.rot);
    const lx = (dx * cr + dy * sr) / s.r, ly = ((-dx * sr + dy * cr) / s.r) * s.sq;
    const d = Math.pow(Math.pow(Math.abs(lx), 2.6) + Math.pow(Math.abs(ly), 2.6), 1 / 2.6);
    if (d < 1) {
      const lit = clamp01(0.5 - (lx * 0.55 + ly * 0.6)); // upper-left facet is bright
      const facet = lit > 0.62 ? 1 : lit > 0.38 ? 0.5 : 0.12; // three painted planes, not a smooth ball
      let col = mix(dark, light, facet);
      col = mix(col, body, 0.45 + s.tone * 0.2);
      c = mix(c, col, smooth(1, 0.82, d));
    }
  }
  return c;
}

/** Dry, red-brown earth: tonal drifts, cracking in patches (rounded plates), pebbles and grit. */
function paintDeadEarth(px: Uint8ClampedArray) {
  const n1 = makeNoise(11), n2 = makeNoise(23), n3 = makeNoise(37);
  const R = rng(5);
  // plates: a periodic Voronoi on a jittered G × G grid (one seed a cell, so only the 3 × 3 cells around a pixel
  // need checking); cracks run where the two nearest seeds are almost equally far
  const G = 18;
  const seeds: [number, number, number][] = [];
  for (let i = 0; i < G * G; i++) seeds.push([((i % G) + R()) / G, (Math.floor(i / G) + R()) / G, R()]);
  const peb = stones(rng(9), 60, 0.005, 0.018);
  // a soft terracotta brown that sits with the game's cream stone and gold (not a raw red)
  const base: RGB = [132, 102, 84], lightDust: RGB = [172, 142, 114], darkEarth: RGB = [102, 78, 66], crack: RGB = [70, 52, 44];
  const stoneBody: RGB = [158, 128, 112], stoneLight: RGB = [214, 188, 164], stoneDark: RGB = [84, 58, 50];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      // warp the lookup a little so plates aren't straight-edged
      const wu = u + (n2(u, v, 12) - 0.5) * 0.02, wv = v + (n3(u, v, 12) - 0.5) * 0.02;
      let d1 = 9, d2 = 9, tone = 0;
      const gx = Math.floor(wu * G), gy = Math.floor(wv * G);
      for (let k = 0; k < 9; k++) {
        const s = seeds[((((gy + Math.floor(k / 3) - 1) % G) + G) % G) * G + ((((gx + (k % 3) - 1) % G) + G) % G)];
        let dx = wu - s[0], dy = wv - s[1];
        dx -= Math.round(dx);
        dy -= Math.round(dy);
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          tone = s[2];
        } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      // where the ground cracks: patches, the rest is dusty and smooth
      const patch = smooth(0.5, 0.66, n1(u, v, 3) * 0.7 + n2(u, v, 6) * 0.3);
      // drifts of lighter dust running diagonally (the wind), and darker damp earth
      const drift = n1(u + v, v - u * 0.35, 4) * 0.6 + n2(u, v, 9) * 0.4;
      let c = mix(mix(darkEarth, base, smooth(0.2, 0.55, drift)), lightDust, smooth(0.55, 0.9, drift) * 0.8);
      c = mix(c, mix(darkEarth, lightDust, tone), patch * 0.16); // each plate its own tone
      // plate edges: a soft bevel into a dark hairline
      c = mix(c, lightDust, patch * smooth(0.012, 0.005, edge) * 0.22);
      c = mix(c, crack, patch * smooth(0.003, 0.001, edge) * 0.6);
      c = stonePass(c, u, v, peb, stoneBody, stoneLight, stoneDark);
      const g = (n3(u, v, 128) - 0.5) * 14 + (n2(u, v, 64) - 0.5) * 8; // grit
      const i = (y * SIZE + x) * 4;
      px[i] = c[0] + g;
      px[i + 1] = c[1] + g * 0.8;
      px[i + 2] = c[2] + g * 0.7;
      px[i + 3] = 255;
    }
}

/** Warm beach sand: soft wind ripples on the diagonal, pale and tawny mottling, the odd pale pebble. */
function paintSand(px: Uint8ClampedArray) {
  const n1 = makeNoise(41), n2 = makeNoise(53), n3 = makeNoise(67);
  const peb = stones(rng(15), 26, 0.005, 0.014);
  const base: RGB = [232, 196, 128], pale: RGB = [246, 220, 160], tawny: RGB = [206, 164, 100], shade: RGB = [178, 136, 84];
  const stoneBody: RGB = [228, 212, 190], stoneLight: RGB = [252, 244, 228], stoneDark: RGB = [168, 132, 92];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      const mottle = n1(u, v, 4) * 0.6 + n2(u, v, 9) * 0.4;
      let c = mix(mix(tawny, base, smooth(0.25, 0.55, mottle)), pale, smooth(0.55, 0.9, mottle) * 0.7);
      // ripples: periodic waves across the diagonal, bent by noise, stronger in some stretches than others
      const ph = (u * 3 + v * 7) * Math.PI * 2 + (n2(u, v, 5) - 0.5) * 5;
      const w = Math.sin(ph);
      const strength = smooth(0.35, 0.7, n3(u, v, 3));
      c = mix(c, pale, smooth(0.3, 1, w) * 0.3 * strength); // crests catch the light
      c = mix(c, shade, smooth(-0.2, -1, w) * 0.22 * strength); // troughs fall into shade
      c = stonePass(c, u, v, peb, stoneBody, stoneLight, stoneDark);
      const g = (n3(u, v, 160) - 0.5) * 10 + (n1(u, v, 80) - 0.5) * 6; // grains
      const i = (y * SIZE + x) * 4;
      px[i] = c[0] + g;
      px[i + 1] = c[1] + g;
      px[i + 2] = c[2] + g * 0.8;
      px[i + 3] = 255;
    }
}

function painted(name: GroundTexName): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  (name === 'sand' ? paintSand : paintDeadEarth)(img.data);
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ───────────── material and mesh ─────────────

const materials = new Map<GroundTexName, pc.StandardMaterial>();

export function groundTexMaterial(device: pc.GraphicsDevice, name: GroundTexName): pc.StandardMaterial {
  const have = materials.get(name);
  if (have) return have;
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseVertexColor = true;
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = 0.1;
  m.cull = pc.CULLFACE_NONE;
  materials.set(name, m);
  const use = (src: HTMLCanvasElement | HTMLImageElement) => {
    const tex = new pc.Texture(device, {
      name: `ground-${name}`,
      mipmaps: true,
      anisotropy: 8,
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_REPEAT,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
    });
    tex.setSource(src);
    m.diffuseMap = tex;
    m.update();
  };
  const url = urlOf(name);
  if (url) {
    m.update();
    const img = new Image();
    img.onload = () => use(img);
    img.onerror = () => use(painted(name));
    img.src = url;
  } else use(painted(name));
  return m;
}

export interface GroundTexGeo {
  pos: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

export const emptyGroundTexGeo = (): GroundTexGeo => ({ pos: [], uv: [], col: [], idx: [] });

/** Adds one tile's top (a 1 × 1 m quad at height y) with world-space texture coordinates. */
export function addGroundQuad(g: GroundTexGeo, name: GroundTexName, x: number, z: number, y: number, rgb: [number, number, number]) {
  const s = TILE_M[name];
  const i = g.pos.length / 3;
  for (const [dx, dz] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    g.pos.push(x + dx, y, z + dz);
    g.uv.push((x + dx) / s, (z + dz) / s);
    g.col.push(rgb[0], rgb[1], rgb[2], 255);
  }
  g.idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
}

export function groundTexMesh(device: pc.GraphicsDevice, g: GroundTexGeo): pc.Mesh | undefined {
  if (!g.idx.length) return undefined;
  const m = new pc.Mesh(device);
  m.setPositions(g.pos);
  m.setNormals(g.pos.map((_, i) => (i % 3 === 1 ? 1 : 0)));
  m.setUvs(0, g.uv);
  m.setColors32(g.col);
  m.setIndices(g.idx);
  m.update(pc.PRIMITIVE_TRIANGLES);
  return m;
}

/** Which painted texture a dead Old City tile wears (none: paving, roads and water keep their own look). */
export function groundTexFor(feature: string | undefined): GroundTexName | undefined {
  const f = feature ?? 'lawn';
  return f === 'sand' ? 'sand' : f === 'lawn' || f === 'litter' || f === 'clay' ? 'dead-earth' : undefined;
}

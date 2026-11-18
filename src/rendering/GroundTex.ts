import * as pc from 'playcanvas';

/**
 * Painted ground textures (owner, 18 Nov 2026): tiling images laid over Old City ground tiles in world space, so
 * the ground runs on without seams from tile to tile and chunk to chunk, instead of flat slabs with drawn-on cracks.
 *
 *  - `sand`: the beach's dead sand (warm gold, wind ripples, pale pebbles)
 *  - `dead-earth`: dead grass, leaf litter and clay (dry brown earth, cracked in patches, small stones)
 *  - `dead-paving`: dead paving (worn cream stone pavers, orange dust in the joints and drifted across)
 *
 * Each is painted procedurally at startup (512², seamless, no download), in the hand-painted look of the owner's
 * reference images. A file in `assets/raw/textures/` named `<name>.png`, `.webp` or `.jpg` replaces the painted
 * one. A chunk draws one extra mesh per texture over the slabs of the tiles that use it; the vertex colour tints it.
 */

const FILES = import.meta.glob('../../assets/raw/textures/*.{png,webp,jpg}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export type GroundTexName = 'sand' | 'dead-earth' | 'dead-paving';
export const GROUND_TEXTURES: GroundTexName[] = ['sand', 'dead-earth', 'dead-paving'];

/** World metres one copy of each texture covers. */
const TILE_M: Record<GroundTexName, number> = { sand: 5, 'dead-earth': 5, 'dead-paving': 4 };
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
  // the dusty orange-red of the owner's pre-restored reference
  const base: RGB = [178, 112, 76], lightDust: RGB = [212, 148, 100], darkEarth: RGB = [138, 84, 60], crack: RGB = [88, 52, 40];
  const stoneBody: RGB = [156, 112, 100], stoneLight: RGB = [212, 170, 148], stoneDark: RGB = [88, 54, 46];
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

/**
 * Fine cracks as real concrete cracks run: a wandering line that forks now and then, each fork thinner and shorter,
 * most of them starting at a joint or a corner. Stamped into a wrapped buffer (1 = the crack's dark core).
 */
function crackField(seed: number): Float32Array {
  const F = new Float32Array(SIZE * SIZE);
  const R = rng(seed);
  const stamp = (x: number, y: number, w: number) => {
    const r = Math.ceil(w + 1.5);
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        const k = clamp01(1 - (d - w * 0.5) / 1.2);
        if (k <= 0) continue;
        const i = (((Math.round(y) + dy) % SIZE) + SIZE) % SIZE * SIZE + ((((Math.round(x) + dx) % SIZE) + SIZE) % SIZE);
        if (k > F[i]) F[i] = k;
      }
  };
  const walk = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    let drift = (R() - 0.5) * 0.02;
    for (let i = 0; i < len; i++) {
      stamp(x, y, w * (1 - (i / len) * 0.6)); // it thins toward its tip
      ang += drift + (R() - 0.5) * 0.35; // small jitters on a slow drift: jagged close up, one line from afar
      if (R() < 0.04) ang += (R() - 0.5) * 1.2; // the odd kink where it met a stone
      if (R() < 0.02) drift = (R() - 0.5) * 0.03;
      x += Math.cos(ang);
      y += Math.sin(ang);
      if (depth < 1 && R() < 0.02) walk(x, y, ang + (R() < 0.5 ? 1 : -1) * (0.5 + R() * 0.6), len * (0.25 + R() * 0.3), w * 0.6, depth + 1);
    }
  };
  // a handful of cracks across the whole texture (16 m²): most slabs stay whole
  for (let i = 0; i < 9; i++) {
    const onJoint = R() < 0.7;
    const jx = Math.round(R() * 2) * (SIZE / 2), jy = Math.round(R() * 2) * (SIZE / 2);
    walk(onJoint ? jx : R() * SIZE, onJoint ? R() * SIZE : jy + R() * 40, R() * 6.283, 30 + R() * 60, 0.9 + R() * 0.6, 0);
  }
  return F;
}

/**
 * Old stone paving, as in the owner's pre-restored reference: cream pavers laid in running bond, edges worn round,
 * each its own tone, orange dust packed in the joints and drifted across in places, a few cracked or missing.
 */
function paintDeadPaving(px: Uint8ClampedArray, H: Float32Array) {
  const n1 = makeNoise(71), n2 = makeNoise(83), n3 = makeNoise(97);
  const cracks = crackField(21);
  const R = rng(31);
  const ROWS = 16, COLS = 8; // pavers of 0.5 × 0.25 m on a 4 m texture
  const tone = new Float32Array(ROWS * COLS), gone = new Uint8Array(ROWS * COLS);
  for (let i = 0; i < tone.length; i++) {
    tone[i] = R();
    gone[i] = R() < 0.035 ? 1 : 0;
  }
  const stone: RGB = [212, 196, 176], pale: RGB = [232, 220, 202], worn: RGB = [184, 164, 146], shadow: RGB = [150, 126, 110];
  const dust: RGB = [196, 132, 92], dustDark: RGB = [150, 94, 66], crackC: RGB = [96, 70, 58];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      const row = Math.floor(v * ROWS);
      const cu = u * COLS + (row % 2) * 0.5; // running bond: every other row shifted half a paver
      const col = ((Math.floor(cu) % COLS) + COLS) % COLS;
      const id = row * COLS + col;
      const fx = cu - Math.floor(cu), fy = v * ROWS - row;
      // distance to the paver's edge in metres-ish units (x is twice as long as y), with a wobble so edges are worn
      const wob = (n3(u, v, 40) - 0.5) * 0.05 + (n2(u, v, 90) - 0.5) * 0.03; // chipped, uneven edges
      const edge = Math.min(Math.min(fx, 1 - fx) * 2, Math.min(fy, 1 - fy)) + wob;
      // the stone: its own tone, a paler worn middle, weather stains
      let c = mix(mix(worn, stone, 0.3 + tone[id] * 0.7), pale, smooth(0.5, 0.9, n1(u, v, 14)) * 0.5);
      c = mix(c, worn, smooth(0.55, 0.85, n2(u, v, 9)) * 0.45);
      c = mix(c, pale, smooth(0.16, 0.3, edge) * 0.12); // a slightly domed top
      // fine cracks across a few pavers, and pitting
      const k = cracks[y * SIZE + x];
      c = mix(c, crackC, smooth(0.55, 0.95, k) * 0.75);
      if (n3(u, v, 200) > 0.88) c = mix(c, worn, 0.5);
      // joints: a soft shadowed lip, then dust packed between the stones
      c = mix(c, shadow, smooth(0.11, 0.05, edge) * 0.55);
      const inJoint = smooth(0.055, 0.03, edge);
      const dustC = mix(dustDark, dust, n2(u, v, 30));
      // the grout: gritty and uneven, darker where it has washed out, dustier where it has silted up
      const grit = n3(u, v, 110) * 0.6 + n1(u, v, 45) * 0.4;
      c = mix(c, mix(mix(shadow, dustC, 0.55), mix(dustDark, shadow, 0.5), smooth(0.4, 0.75, grit)), inJoint);
      // a missing paver: bare dusty earth, darker at its rim
      if (gone[id]) c = mix(mix(dustDark, dust, n1(u, v, 24) * 0.7), shadow, smooth(0.2, 0.03, edge) * 0.5);
      // dust drifted over the paving on the wind: thick in places, a thin wash elsewhere
      const drift = n1(u + v * 0.6, v - u * 0.3, 3) * 0.65 + n2(u, v, 7) * 0.35;
      c = mix(c, dustC, smooth(0.62, 0.8, drift) * 0.7 + 0.02);
      // height: a rounded top standing above the joint, each paver sunk or tilted a little, pitted and cracked;
      // drifted dust levels it out
      const driftK = smooth(0.62, 0.8, drift);
      let hgt = smooth(0.02, 0.14, edge) * (0.8 + tone[id] * 0.2) + (fx - 0.5) * (tone[(id * 7) % tone.length] - 0.5) * 0.25;
      hgt += (n3(u, v, 60) - 0.5) * 0.1 + (n1(u, v, 24) - 0.5) * 0.08; // worn, uneven stone
      hgt -= smooth(0.5, 0.95, k) * 0.5 + (n3(u, v, 200) > 0.88 ? 0.12 : 0);
      hgt += inJoint * (grit - 0.5) * 0.3;
      if (gone[id]) hgt = 0.1 + n1(u, v, 24) * 0.15;
      H[y * SIZE + x] = hgt * (1 - driftK * 0.7) + driftK * 0.55;
      const g = (n3(u, v, 150) - 0.5) * 9 + (n1(u, v, 60) - 0.5) * 6;
      const i = (y * SIZE + x) * 4;
      px[i] = c[0] + g;
      px[i + 1] = c[1] + g * 0.9;
      px[i + 2] = c[2] + g * 0.8;
      px[i + 3] = 255;
    }
}

/** How strongly each height field tilts its normals (kept gentle: weathering, not relief). */
const NORMAL_STRENGTH = 2.2;

function canvasOf(fill: (px: Uint8ClampedArray) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  return cv;
}

function painted(name: GroundTexName): { colour: HTMLCanvasElement; normal?: HTMLCanvasElement } {
  if (name !== 'dead-paving') return { colour: canvasOf(name === 'sand' ? paintSand : paintDeadEarth) };
  const H = new Float32Array(SIZE * SIZE);
  const colour = canvasOf((px) => paintDeadPaving(px, H));
  // a tangent-space normal map from the heights (wrapped, so it tiles like the colour)
  const at = (x: number, y: number) => H[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  const normal = canvasOf((px) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const dx = (at(x - 1, y) - at(x + 1, y)) * NORMAL_STRENGTH;
        const dy = (at(x, y - 1) - at(x, y + 1)) * NORMAL_STRENGTH;
        const l = 1 / Math.hypot(dx, dy, 1);
        const i = (y * SIZE + x) * 4;
        px[i] = (dx * l * 0.5 + 0.5) * 255;
        px[i + 1] = (dy * l * 0.5 + 0.5) * 255;
        px[i + 2] = (l * 0.5 + 0.5) * 255;
        px[i + 3] = 255;
      }
  });
  return { colour, normal };
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
  const texOf = (src: HTMLCanvasElement | HTMLImageElement, kind: string) => {
    const tex = new pc.Texture(device, {
      name: `ground-${name}-${kind}`,
      mipmaps: true,
      anisotropy: 8,
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_REPEAT,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
    });
    tex.setSource(src);
    return tex;
  };
  const usePainted = () => {
    const t = painted(name);
    m.diffuseMap = texOf(t.colour, 'colour');
    if (t.normal) {
      m.normalMap = texOf(t.normal, 'normal');
      m.bumpiness = 0.6;
    }
    m.update();
  };
  const url = urlOf(name);
  if (url) {
    m.update();
    const img = new Image();
    img.onload = () => {
      m.diffuseMap = texOf(img, 'colour');
      m.update();
    };
    img.onerror = usePainted;
    img.src = url;
  } else usePainted();
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

/** Which painted texture a dead Old City tile wears (none: roads and water keep their own look). */
export function groundTexFor(feature: string | undefined): GroundTexName | undefined {
  const f = feature ?? 'lawn';
  return f === 'sand' ? 'sand' : f === 'paving' ? 'dead-paving' : f === 'lawn' || f === 'litter' || f === 'clay' ? 'dead-earth' : undefined;
}

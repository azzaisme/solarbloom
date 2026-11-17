import * as pc from 'playcanvas';

/**
 * Look 3.1 (#128): the texture and material pipeline.
 *
 * Approach (see docs/art/surfaces.md): tiling *detail* textures layered over the vertex colours in world space,
 * not per-mesh UVs. The chunk ground, props and foliage stay merged vertex-coloured meshes (one draw call per
 * chunk), and a shader chunk on the shared material multiplies in fine detail picked by the surface itself:
 *
 *  - which layer: from the vertex colour (green → grass, low saturation → stone, anything else → generic grain;
 *    very dark greys and cool cyans, i.e. glass, windows and water, get none),
 *    or forced per material (`mat(hex, { detail: 'metal' })`);
 *  - where: projected on the dominant world axis of the normal (one fetch per layer, no UVs needed), at two
 *    scales mixed so nothing visibly repeats over a 10×10 area;
 *  - how strong: faded out with camera distance, so the far view is plain colour (mip-mapped and cheap).
 *
 * Two 256² RGBA textures, made procedurally at startup (no download: 0 KB, ~0.7 MB GPU memory with mips):
 *  - detail: R stone grain + cracks, G grass streaks, B generic grain (bark, metal, plaster), A spare;
 *  - normal: RG stone normal (x, y), BA grass normal (x, y).
 * They are generated a slice at a time after first paint (`DetailTextures.step`), with flat 1×1 placeholders
 * until then, so first paint isn't delayed. A future KTX2/Basis atlas can replace them through `useTextures`.
 */

const SIZE = 256;

/** Periodic value noise on a SIZE grid (period p lattice cells). */
function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  let s = seed >>> 0;
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const h = (x: number, y: number) => perm[(perm[x & 255] + (y & 255)) & 511] / 255;
  return (x: number, y: number, p: number) => {
    const fx = (x / SIZE) * p;
    const fy = (y / SIZE) * p;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const x1 = (x0 + 1) % p;
    const y1 = (y0 + 1) % p;
    const a = h(x0 % p, y0 % p);
    const b = h(x1, y0 % p);
    const c = h(x0 % p, y1);
    const d = h(x1, y1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Periodic cell (Voronoi) edge distance: small near cell borders (the cracks between stone grains). */
function makeCells(seed: number, cells: number) {
  const pts: [number, number][] = [];
  let s = seed >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < cells * cells; i++) pts.push([((i % cells) + 0.15 + 0.7 * r()) / cells, (Math.floor(i / cells) + 0.15 + 0.7 * r()) / cells]);
  return (x: number, y: number) => {
    const u = x / SIZE;
    const v = y / SIZE;
    const cx = Math.floor(u * cells);
    const cy = Math.floor(v * cells);
    let d1 = 9;
    let d2 = 9;
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const gx = (cx + ox + cells) % cells;
        const gy = (cy + oy + cells) % cells;
        const p = pts[gy * cells + gx];
        // wrap-aware: the neighbour cell's point, shifted by whole periods when the cell index wrapped
        const wx = p[0] + (cx + ox - gx) / cells;
        const wy = p[1] + (cy + oy - gy) / cells;
        const d = Math.hypot(u - wx, v - wy);
        if (d < d1) [d1, d2] = [d, d1];
        else if (d < d2) d2 = d;
      }
    return (d2 - d1) * cells; // 0 at an edge … ~0.5+ inside
  };
}

export interface DetailMaps {
  detail: Uint8Array;
  normal: Uint8Array;
}

/** Builds the two detail maps (pure; ~10 ms on a laptop). A generator so it can run a few rows per frame. */
export function* buildDetailMaps(): Generator<void, DetailMaps> {
  const n1 = makeNoise(11);
  const n2 = makeNoise(23);
  const n3 = makeNoise(37);
  const cells = makeCells(5, 9);
  const stoneH = new Float32Array(SIZE * SIZE);
  const grassH = new Float32Array(SIZE * SIZE);
  const detail = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      // stone: soft blotches, fine grain, and hairline cracks along cell borders
      const blot = n1(x, y, 4) * 0.5 + n1(x, y, 8) * 0.3 + n2(x, y, 32) * 0.2;
      const grain = n3(x, y, 64) * 0.6 + n2(x, y, 128) * 0.4;
      const e = cells(x, y);
      const crack = e < 0.06 && n2(x, y, 16) > 0.42 ? 1 - e / 0.06 : 0;
      const stone = 0.8 + 0.2 * blot + 0.12 * (grain - 0.5) - 0.16 * crack;
      stoneH[i] = blot * 0.6 + grain * 0.5 - crack * 0.5;
      // grass (Phase 6): a soft lawn: gentle clumps and a fine speckle, no blade streaks (the crossing streaks and
      // their bump read as combed playdough at play zoom). Almost flat, so the normal map barely tilts the light.
      const clump = n1(x, y, 8) * 0.6 + n2(x, y, 16) * 0.4;
      const speck = n3(x, y, 64) * 0.5 + n2(x, y, 128) * 0.5;
      const grass = 0.8 + 0.2 * clump + 0.08 * (speck - 0.5);
      grassH[i] = clump * 0.12 + speck * 0.06;
      // generic: fine grain for plaster, bark and metal
      const gen = 0.86 + 0.14 * (n3(x, y, 16) * 0.5 + n2(x, y, 64) * 0.5);
      detail[i * 4] = Math.round(Math.max(0, Math.min(1, stone)) * 255);
      detail[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, grass)) * 255);
      detail[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, gen)) * 255);
      detail[i * 4 + 3] = Math.round(crack * 255);
    }
    if ((y & 15) === 15) yield;
  }
  const normal = new Uint8Array(SIZE * SIZE * 4);
  const at = (H: Float32Array, x: number, y: number) => H[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const sx = (at(stoneH, x + 1, y) - at(stoneH, x - 1, y)) * 2.2;
      const sy = (at(stoneH, x, y + 1) - at(stoneH, x, y - 1)) * 2.2;
      const gx = (at(grassH, x + 1, y) - at(grassH, x - 1, y)) * 3;
      const gy = (at(grassH, x, y + 1) - at(grassH, x, y - 1)) * 3;
      normal[i] = Math.round((Math.max(-1, Math.min(1, -sx)) * 0.5 + 0.5) * 255);
      normal[i + 1] = Math.round((Math.max(-1, Math.min(1, -sy)) * 0.5 + 0.5) * 255);
      normal[i + 2] = Math.round((Math.max(-1, Math.min(1, -gx)) * 0.5 + 0.5) * 255);
      normal[i + 3] = Math.round((Math.max(-1, Math.min(1, -gy)) * 0.5 + 0.5) * 255);
    }
    if ((y & 31) === 31) yield;
  }
  return { detail, normal };
}

// ───────────── shader chunks ─────────────

/** Shared declarations and the layer weights / projection, included by the diffuse and normal chunks. */
const DETAIL_COMMON = /* glsl */ `
uniform sampler2D uDetailTex;
uniform sampler2D uDetailNrm;
uniform vec4 uDetailParams; // strength, normal strength, fade start, fade end (world units from the camera)
uniform vec4 uDetailForce;  // stone, grass, generic weights; w = 1 to use these instead of the vertex colour
uniform vec3 uDetailCam;
vec3 sbW;
vec2 sbUV;
vec3 sbT;
vec3 sbB;
float sbK;
void sbDetailSetup(vec3 col, vec3 n) {
	vec3 p = vPositionW;
	vec3 an = abs(n);
	if (an.y > 0.6) { sbUV = p.xz; sbT = vec3(1.0, 0.0, 0.0); sbB = vec3(0.0, 0.0, 1.0); }
	else if (an.x > an.z) { sbUV = p.zy; sbT = vec3(0.0, 0.0, 1.0); sbB = vec3(0.0, 1.0, 0.0); }
	else { sbUV = p.xy; sbT = vec3(1.0, 0.0, 0.0); sbB = vec3(0.0, 1.0, 0.0); }
	float mx = max(col.r, max(col.g, col.b));
	float mn = min(col.r, min(col.g, col.b));
	float sat = (mx - mn) / max(mx, 0.001);
	float green = smoothstep(0.02, 0.12, col.g - max(col.r, col.b) * 0.9) * step(0.12, sat);
	float stone = (1.0 - green) * (1.0 - smoothstep(0.12, 0.3, sat));
	// glass and windows stay smooth: very dark greys (window bands, dead glass) and cool cyans (clear glass, water)
	float glass = max(1.0 - smoothstep(0.09, 0.2, mx), smoothstep(0.12, 0.3, col.b - col.r) * step(col.r, col.g));
	vec3 sbAuto = vec3(stone, green, max(0.0, 1.0 - stone - green)) * (1.0 - glass);
	sbW = mix(sbAuto, uDetailForce.xyz, uDetailForce.w);
	float d = distance(uDetailCam, p);
	sbK = 1.0 - smoothstep(uDetailParams.z, uDetailParams.w, d);
}
`;

const DIFFUSE_PS = /* glsl */ `
uniform vec3 material_diffuse;
${DETAIL_COMMON}
void getAlbedo() {
	dAlbedo = material_diffuse.rgb;
	#ifdef STD_DIFFUSE_VERTEX
		dAlbedo *= saturate(vVertexColor.rgb);
	#endif
	sbDetailSetup(dAlbedo, normalize(vNormalW));
	if (sbK > 0.001) {
		// two scales, the second rotated, so the pattern doesn't repeat visibly
		vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * sbUV * 0.37 + 0.31;
		vec3 a = texture2D(uDetailTex, sbUV * 0.5).rgb;
		vec3 b = texture2D(uDetailTex, uv2).rgb;
		vec3 t = a * b * 1.28;
		float k = dot(t, sbW);
		dAlbedo *= mix(1.0, k, uDetailParams.x * sbK);
	}
}
`;

const NORMAL_PS = /* glsl */ `
#ifdef STD_NORMAL_TEXTURE
	uniform float material_bumpiness;
#endif
void getNormal() {
#ifdef STD_NORMAL_TEXTURE
	vec3 normalMap = {STD_NORMAL_TEXTURE_DECODE}(texture2DBias({STD_NORMAL_TEXTURE_NAME}, {STD_NORMAL_TEXTURE_UV}, {STD_TEXTURE_BIAS}));
	normalMap = mix(vec3(0.0, 0.0, 1.0), normalMap, material_bumpiness);
	dNormalW = normalize(dTBN * normalMap);
#else
	dNormalW = dVertexNormalW;
	if (sbK > 0.001 && uDetailParams.y > 0.0) {
		vec4 nm = texture2D(uDetailNrm, sbUV * 0.5) * 2.0 - 1.0;
		vec2 d = nm.xy * sbW.x + nm.zw * sbW.y;
		dNormalW = normalize(dNormalW + (sbT * d.x + sbB * d.y) * uDetailParams.y * sbK);
	}
#endif
}
`;

export type DetailLayer = 'stone' | 'grass' | 'metal' | 'bark' | 'plaster';
const FORCE: Record<DetailLayer, [number, number, number, number]> = {
  stone: [1, 0, 0, 1],
  grass: [0, 1, 0, 1],
  metal: [0, 0, 0.6, 1],
  bark: [0.3, 0, 0.9, 1],
  plaster: [0.45, 0, 0.55, 1],
};

/** Quality-tier settings: strength of albedo and normal detail, and the distance band it fades over. */
const TIER = {
  low: [0.55, 0, 9, 20],
  medium: [0.8, 0.3, 14, 32],
  high: [0.9, 0.4, 18, 45],
} as const;
export type DetailTier = keyof typeof TIER;

class DetailTextures {
  private placeholderTex?: pc.Texture;
  private placeholderNrm?: pc.Texture;
  tex?: pc.Texture;
  nrm?: pc.Texture;
  private gen?: Generator<void, DetailMaps>;
  private mats = new Set<pc.StandardMaterial>();
  private params: number[] = [...TIER.high];
  private cam = [0, 0, 0];
  device?: pc.GraphicsDevice;

  init(device: pc.GraphicsDevice) {
    if (this.device) return;
    this.device = device;
    const flat = (r: number, g: number, b: number, a: number) => {
      const t = new pc.Texture(device, { width: 1, height: 1, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, name: 'detail-flat' });
      const px = t.lock();
      px.set([r, g, b, a]);
      t.unlock();
      return t;
    };
    this.placeholderTex = flat(200, 200, 200, 0);
    this.placeholderNrm = flat(128, 128, 128, 128);
    this.gen = buildDetailMaps();
  }

  /** Generates a slice of the maps (a few ms); call once per frame until it returns false. */
  step(): boolean {
    if (!this.gen || !this.device) return false;
    const r = this.gen.next();
    if (!r.done) return true;
    this.gen = undefined;
    this.useTextures(this.upload(r.value.detail, 'detail-albedo'), this.upload(r.value.normal, 'detail-normal'));
    return false;
  }

  private upload(data: Uint8Array, name: string) {
    const t = new pc.Texture(this.device!, {
      width: SIZE,
      height: SIZE,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_REPEAT,
      anisotropy: 4,
      name,
    });
    const px = t.lock();
    px.set(data);
    t.unlock();
    return t;
  }

  /** Swaps in the real maps (procedural today; a compressed KTX2 atlas loaded through the asset registry later). */
  useTextures(tex: pc.Texture, nrm: pc.Texture) {
    this.tex = tex;
    this.nrm = nrm;
    for (const m of this.mats) this.bind(m);
  }

  private bind(m: pc.StandardMaterial) {
    m.setParameter('uDetailTex', this.tex ?? this.placeholderTex!);
    m.setParameter('uDetailNrm', this.nrm ?? this.placeholderNrm!);
    m.setParameter('uDetailParams', this.tex ? this.params : [0, 0, 1, 2]);
  }

  setTier(t: DetailTier) {
    this.params = [...TIER[t]];
    for (const m of this.mats) this.bind(m);
  }

  setCamera(x: number, y: number, z: number) {
    this.cam[0] = x;
    this.cam[1] = y;
    this.cam[2] = z;
    for (const m of this.mats) m.setParameter('uDetailCam', this.cam);
  }

  /** Adds the detail chunks to a material (vertex-coloured or plain). `force` picks the layer explicitly. */
  apply(m: pc.StandardMaterial, force?: DetailLayer) {
    try {
      const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
      chunks.set('diffusePS', DIFFUSE_PS);
      chunks.set('normalMapPS', NORMAL_PS);
    } catch {
      return; // an engine without per-material chunks: plain vertex colours
    }
    m.setParameter('uDetailForce', force ? FORCE[force] : [0, 0, 0, 0]);
    m.setParameter('uDetailCam', this.cam);
    this.mats.add(m);
    if (this.device) this.bind(m);
    m.update();
  }
}

/** The one detail-texture service (materials register with it; Game drives `step` / `setCamera` / `setTier`). */
export const detailTextures = new DetailTextures();

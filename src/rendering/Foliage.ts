import * as pc from 'playcanvas';
import { SOLID_SINK, foliageShape, geoBounds, type FoliageShape, type GeoBounds } from '../core/Solids';
import type { TreeGeo } from './TreeGen';
import { LOOK } from '../data/look';
import { WIND_GLSL } from './Wind';
import { transitionMaterial } from './transitions/TransitionMaterial';

/**
 * Phase 5 visual overhaul: the foliage material (vertex colours + wind) and a builder that stamps cached tree
 * geometry into one merged mesh per chunk.
 *
 * Wind: each vertex's 4th position component is its "flex" (0 at the roots … ~1 at outer leaves). The material
 * overrides PlayCanvas's GLSL `transformVS` chunk so the vertex moves by a gust that travels across the world,
 * a smaller side sway and a leaf flutter, all scaled by flex. Shadows use the same chunk, so they sway too.
 * Reduced motion sets the strength to 0.
 *
 * See-through trees: every vertex also carries its tree's base (x, y, z) and height (`vertex_tree`). A tree whose
 * screen silhouette (a capsule from base to top) covers the cursor, and that stands in front of the ground under
 * the cursor, turns see-through with an ordered dither, so the tile behind it stays visible. Shadows stay solid.
 */

const WIND_TRANSFORM = /* glsl */ `
#ifdef PIXELSNAP
uniform vec4 screen_size;
#endif
#ifdef SCREENSPACE
uniform float projectionFlipY;
#endif
${WIND_GLSL}
varying float vLeaf;
varying vec3 vLeafP;
vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
	vec3 localPos = getLocalPosition(vertexPosition);
	vec4 posW = modelMatrix * vec4(localPos, 1.0);
	// flex carries LEAF_FLAG (2) on foliage clumps: leaves are drawn over those by the fragment shader
	float w = vertex_position.w;
	vLeaf = step(1.99, w);
	vLeafP = posW.xyz; // before the wind, so the leaves don't swim over the clump
	posW.xyz += windOffset(posW.xyz, w - vLeaf * 2.0);
	return posW;
}
vec4 getPosition() {
	dModelMatrix = getModelMatrix();
	vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
	dPositionW = posW.xyz;
	vec4 screenPos;
	#ifdef UV1LAYOUT
		screenPos = vec4(vertex_texCoord1.xy * 2.0 - 1.0, 0.5, 1);
	#else
		#ifdef SCREENSPACE
			screenPos = posW;
			screenPos.y *= projectionFlipY;
		#else
			screenPos = matrix_viewProjection * posW;
		#endif
	#endif
	return screenPos;
}
vec3 getWorldPosition() {
	return dPositionW;
}
`;

/**
 * Look 3.7: leaves on every foliage clump, drawn in the fragment shader (no extra triangles). A 3D cellular pattern
 * in world space, so neighbouring clumps and trees share one leaf size: each cell is a rounded leaf, lit on the side
 * toward the sun and bent outward a little (the normal tilts with it), with dark gaps between leaves and a small
 * per-leaf shift in tone. It fades out where a leaf would shrink below a few pixels, so distant trees stay smooth
 * instead of shimmering. Everything else in the foliage mesh (grass, stems, petals, bark) is untouched.
 */
const LEAF_DECL_PS = /* glsl */ `
varying float vLeaf;
varying vec3 vLeafP;
uniform vec4 uLeafParams; // strength, normal tilt, leaves per world unit, unused
vec3 sbLeafBend;
float sbLeafK;
`;

const LEAF_DIFFUSE_PS = /* glsl */ `
uniform vec3 material_diffuse;
vec3 sbLeafHash(vec3 p) {
	p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
	return fract(sin(p) * 43758.5453);
}
void getAlbedo() {
	dAlbedo = material_diffuse.rgb;
	#ifdef STD_DIFFUSE_VERTEX
		dAlbedo *= saturate(vVertexColor.rgb);
	#endif
	sbLeafBend = vec3(0.0);
	sbLeafK = 0.0;
	if (vLeaf < 0.5 || uLeafParams.x <= 0.0) return;
	vec3 p = vLeafP * uLeafParams.z;
	float px = length(fwidth(p));
	float k = 1.0 - smoothstep(0.35, 0.8, px);
	if (k <= 0.001) return;
	vec3 ip = floor(p);
	vec3 fp = fract(p);
	float d1 = 9.0;
	float d2 = 9.0;
	vec3 o1 = vec3(0.0);
	vec3 h1 = vec3(0.0);
	for (int z = -1; z <= 1; z++)
	for (int y = -1; y <= 1; y++)
	for (int x = -1; x <= 1; x++) {
		vec3 g = vec3(float(x), float(y), float(z));
		vec3 h = sbLeafHash(ip + g);
		vec3 r = g + 0.1 + h * 0.8 - fp;
		float d = dot(r, r);
		if (d < d1) { d2 = d1; d1 = d; o1 = r; h1 = h; }
		else if (d < d2) d2 = d;
	}
	d1 = sqrt(d1);
	d2 = sqrt(d2);
	vec3 n = normalize(vNormalW);
	// from the leaf's centre to this point, flattened onto the clump's surface
	vec3 q = -o1;
	q -= n * dot(q, n);
	// Owner review: strong seams read as a turtle shell. Leaves now read by their own light, like the reference:
	// each one bright on its sunny upper edge and shaded underneath (where the next leaf overlaps it), with only
	// a thin soft seam between them.
	float gap = smoothstep(0.0, 0.08, d2 - d1);
	float leaf = mix(0.8, 1.0, gap);
	float lit = clamp(0.5 + 1.3 * dot(q, normalize(vec3(0.45, 0.8, 0.3))), 0.0, 1.0);
	float tone = leaf * mix(0.7, 1.2, lit * lit) * mix(0.92, 1.06, h1.x);
	vec3 tint = vec3(1.0 + (h1.y - 0.5) * 0.16, 1.0 + (h1.z - 0.5) * 0.06, 1.0 - (h1.y - 0.5) * 0.12);
	float s = uLeafParams.x * k;
	dAlbedo *= mix(vec3(1.0), tint * tone, s);
	sbLeafBend = q * 1.1;
	sbLeafK = s;
}
`;

const LEAF_NORMAL_PS = /* glsl */ `
void getNormal() {
	dNormalW = dVertexNormalW;
	if (sbLeafK > 0.001) dNormalW = normalize(dNormalW + sbLeafBend * uLeafParams.y * sbLeafK);
}
`;

/** Declares the per-vertex tree attribute and the cursor uniforms. */
const TREE_USER_CODE = /* glsl */ `
attribute vec4 vertex_tree;
uniform vec4 uTreeCursor; // cursor in NDC (x, y), view depth of the ground under it, strength 0..1
uniform vec2 uTreeScreen; // canvas size in pixels
uniform vec2 uNearFade; // a tree nearer than x + y × its height (view depth) is left out
`;

/**
 * Fades the vertex's alpha when its tree covers the cursor (forward pass; shadows ignore opacity).
 * P7-E29.3 (#736): and a tree right in front of the camera (a crown the follow camera backs into, or that fills a
 * fixed view) is left out whole: decided per tree (its base and crown's view depth, against a distance that grows
 * with its height), so it goes cleanly in one frame instead of dithering into a screen of holes; its shadow stays.
 */
const TREE_MAIN_END = /* glsl */ `
	#ifdef VERTEX_COLOR
	if (vertex_tree.w > 0.6) {
		vec4 nb = dModelMatrix * vec4(vertex_tree.xyz, 1.0);
		float nh = vertex_tree.w * length(dModelMatrix[1].xyz);
		float d0 = (matrix_viewProjection * nb).w;
		float d1 = (matrix_viewProjection * vec4(nb.xyz + vec3(0.0, nh * 0.65, 0.0), 1.0)).w;
		if (min(d0, d1) < uNearFade.x + uNearFade.y * nh) vVertexColor.a = 0.0;
	}
	if (uTreeCursor.w > 0.001 && vertex_tree.w > 0.0) {
		vec4 b = dModelMatrix * vec4(vertex_tree.xyz, 1.0);
		float h = vertex_tree.w * length(dModelMatrix[1].xyz);
		vec4 cb = matrix_viewProjection * b;
		vec4 ct = matrix_viewProjection * vec4(b.xyz + vec3(0.0, h, 0.0), 1.0);
		if (cb.w > 0.0 && ct.w > 0.0 && uTreeCursor.z > cb.w + 0.25) {
			vec2 hs = uTreeScreen * 0.5;
			vec2 pb = cb.xy / cb.w * hs;
			vec2 pt = ct.xy / ct.w * hs;
			vec2 pc0 = uTreeCursor.xy * hs;
			vec2 seg = pt - pb;
			float len = max(length(seg), 1.0);
			float t = clamp(dot(pc0 - pb, seg) / (len * len), 0.0, 1.0);
			float d = length(pc0 - (pb + seg * t));
			// Canopies are roughly 0.42 of the height across (P7-E29: up to ~0.5 for the broad variants); the foot needs less.
			float r = len * mix(0.18, 0.5, smoothstep(0.0, 0.45, t));
			float cover = 1.0 - smoothstep(r * 0.85, r * 1.25, d);
			vVertexColor.a *= 1.0 - 0.72 * cover * uTreeCursor.w;
		}
	}
	#endif
`;

/**
 * P7-E29.6 (#739): dappled shade. In the shadow pass only, a crown's leaf masses (the LEAF_FLAG vertices) let light
 * through in soft, leaf-sized gaps: a world-space value noise discards the shadow where it dips below the dapple
 * strength, so the ground under a tree shows sun flecks instead of one solid blob. The forward pass keeps the
 * vertex alpha (the see-through effect) exactly as before. No extra triangles; Low turns it off.
 * The noise is taken on the plane across the sunlight (LOOK.sun), so gaps line up through a crown's depth.
 */
function dappleSun(): number[] {
  const e = (LOOK.sun.elevation * Math.PI) / 180;
  const [hx, hz] = LOOK.sun.toward;
  const h = Math.hypot(hx, hz) || 1;
  return [(hx / h) * Math.cos(e), -Math.sin(e), (hz / h) * Math.cos(e)];
}
const DAPPLE_OPACITY_PS = /* glsl */ `
uniform float material_alphaDitherScale;
uniform vec4 uDapple; // gap share (0 off), gap cells per world unit, unused, unused
uniform vec3 uDappleSun; // the way the sunlight travels (unit)
float sbDapHash(vec3 p) {
	return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float sbDapNoise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(sbDapHash(i), sbDapHash(i + vec3(1, 0, 0)), f.x), mix(sbDapHash(i + vec3(0, 1, 0)), sbDapHash(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(sbDapHash(i + vec3(0, 0, 1)), sbDapHash(i + vec3(1, 0, 1)), f.x), mix(sbDapHash(i + vec3(0, 1, 1)), sbDapHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void getOpacity() {
	dAlpha = 1.0;
	#ifdef FORWARD_PASS
		#ifdef STD_OPACITY_VERTEX
		dAlpha = clamp(vVertexColor.{STD_OPACITY_VERTEX_CHANNEL}, 0.0, 1.0);
		// a nearly gone tree is gone: the ordered dither keeps 1 pixel in 64 at any alpha above zero, which left a
		// speckle where a faded crown stood in front of the camera
		if (dAlpha < 0.08) discard;
		#endif
	#else
		if (vLeaf > 0.5 && uDapple.x > 0.0) {
			// on the plane across the sunlight, so every face along one ray (a crown's near and far sides, and the
			// clusters behind) opens the same gap and the light really gets through
			vec3 p = (vLeafP - uDappleSun * dot(vLeafP, uDappleSun)) * uDapple.y;
			float n = 0.65 * sbDapNoise(p) + 0.35 * sbDapNoise(p * 2.3 + 7.1);
			if (n < uDapple.x) discard;
		}
	#endif
}
`;
/** Dapple per quality tier: [gap share, gap cells per tile] (P7 config). */
export const DAPPLE_TIER = { low: [0, 3.2, 0, 0], medium: [0.34, 3.2, 0, 0], high: [0.4, 3.2, 0, 0] } as const;

/** P7-E29.3: a tree whose base or crown is nearer the camera than [a + b × its height] (view depth, tiles) is left out */
export const NEAR_FADE = [0.7, 0.55] as const;

let material: pc.StandardMaterial | undefined;
/** Look 3.7: leaf pattern per quality tier: strength, normal tilt, leaves per tile (about 4 cm leaves) */
// Phase 6: much softer and larger leaves: at full strength the pattern read as scales (broccoli) at play zoom
const LEAF_TIER = { low: [0.3, 0, 14, 0], medium: [0.35, 0.2, 14, 0], high: [0.4, 0.3, 14, 0] } as const;
let leafTier: keyof typeof LEAF_TIER = 'high';

/** Look 3.7: the leaf pattern's quality tier (Low skips the per-leaf lighting). */
export function setLeafTier(t: keyof typeof LEAF_TIER) {
  leafTier = t;
  material?.setParameter('uLeafParams', [...LEAF_TIER[t]]);
  material?.setParameter('uDapple', [...DAPPLE_TIER[t]]);
  material?.setParameter('uDappleSun', dappleSun());
}
let windStrength = 1;

/** The shared foliage material (merged chunk trees, growing trees, showcase). */
export function foliageMaterial(): pc.StandardMaterial {
  if (material) return material;
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseVertexColor = true;
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = 0.22;
  // Opacity comes from the vertex alpha, which only the see-through effect lowers; dithered, so no sorting.
  m.opacityVertexColor = true;
  m.opacityVertexColorChannel = 'a';
  m.opacityDither = pc.DITHER_BAYER8;
  // P7-E29.6: the shadow pass runs the opacity chunk (DAPPLE_OPACITY_PS) for dappled shade; it never dithers there
  m.opacityShadowDither = pc.DITHER_BAYER8;
  m.setAttribute('vertex_tree', pc.SEMANTIC_ATTR12);
  try {
    const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
    chunks.set('transformVS', WIND_TRANSFORM);
    chunks.set('litUserCodeVS', TREE_USER_CODE);
    chunks.set('litUserMainEndVS', TREE_MAIN_END);
    chunks.set('litUserDeclarationPS', LEAF_DECL_PS);
    chunks.set('diffusePS', LEAF_DIFFUSE_PS);
    chunks.set('normalMapPS', LEAF_NORMAL_PS);
    chunks.set('opacityPS', DAPPLE_OPACITY_PS);
  } catch {
    /* an engine without per-material chunks: trees simply don't sway or fade */
  }
  m.setParameter('uTreeCursor', [0, 0, 0, 0]);
  m.setParameter('uTreeScreen', [1, 1]);
  m.setParameter('uNearFade', [...NEAR_FADE]);
  m.setParameter('uLeafParams', [...LEAF_TIER[leafTier]]);
  m.setParameter('uDapple', [...DAPPLE_TIER[leafTier]]);
  m.setParameter('uDappleSun', dappleSun());
  m.setParameter('uWindTime', 0);
  m.setParameter('uWindStrength', windStrength);
  m.setParameter('uBloomWave', [0, 0, 0, 0]);
  m.update();
  return (material = m);
}

/** Advances the wind (once per frame). `strength` 0 = still (reduced motion). */
export function updateWind(time: number, strength = windStrength) {
  windStrength = strength;
  for (const m of [foliageMaterial(), transitionMaterial()]) {
    m.setParameter('uWindTime', time);
    m.setParameter('uWindStrength', strength);
  }
}

/**
 * The waymark's Bloom Pulse ring passing through the grass, flowers and trees: centre (x, z) in world units, its
 * radius now and how hard it pushes (0: off). Called each frame while a pulse runs, then once with 0.
 */
export function setBloomWave(x: number, z: number, radius: number, strength: number) {
  const wave = [x, z, radius, strength];
  foliageMaterial().setParameter('uBloomWave', wave);
  transitionMaterial().setParameter('uBloomWave', wave);
}

/**
 * Where the cursor is for see-through trees: NDC position, the view depth of the ground under it and a strength
 * (0 = off). Called once per frame.
 */
export function setTreeCursor(ndcX: number, ndcY: number, depth: number, strength: number, w: number, h: number) {
  const m = foliageMaterial();
  m.setParameter('uTreeCursor', [ndcX, ndcY, depth, strength]);
  m.setParameter('uTreeScreen', [w, h]);
}

class Grow<T extends Float32Array | Uint8Array | Uint32Array> {
  n = 0;
  constructor(public a: T) {}
  reserve(k: number) {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new (this.a.constructor as new (n: number) => T)(cap);
    b.set(this.a.subarray(0, this.n) as never);
    this.a = b;
  }
  view(): T {
    return this.a.subarray(0, this.n) as T;
  }
}

/** Stamps cached tree geometry (rotated about Y, scaled, moved) into one merged foliage mesh. */
const FOLIAGE_BOUNDS = new WeakMap<TreeGeo, GeoBounds>();
/** E23.12.3: a foliage geometry's bounds (x y z flex a vertex), worked out once per geometry. */
export function foliageBounds(g: TreeGeo): GeoBounds {
  let b = FOLIAGE_BOUNDS.get(g);
  if (!b) FOLIAGE_BOUNDS.set(g, (b = geoBounds(g.pos, 4)));
  return b;
}

const FOLIAGE_SHAPES = new WeakMap<TreeGeo, FoliageShape>();
/** E23.12.3: a tree or shrub geometry as trunk and crown (core/Solids foliageShape), worked out once per geometry. */
export function foliageShapeOf(g: TreeGeo): FoliageShape {
  let f = FOLIAGE_SHAPES.get(g);
  if (!f) FOLIAGE_SHAPES.set(g, (f = foliageShape(g.pos, 4)));
  return f;
}

export class FoliageBuilder {
  private pos = new Grow(new Float32Array(1 << 14));
  private nrm = new Grow(new Float32Array(1 << 14));
  private col = new Grow(new Uint8Array(1 << 14));
  private tree = new Grow(new Float32Array(1 << 14));
  private idx = new Grow(new Uint32Array(1 << 14));
  /** 0 = full colour … 1 = grey (fog), as in the chunk builder */
  grey = 0;
  tris = 0;

  /**
   * `fade`: false for a tree that must never fade or drop out near the camera or under the cursor (a giant tree, whose
   * canopy the follow camera goes under on purpose): its tree height is written as 0, which the shader skips.
   */
  add(g: TreeGeo, x: number, y: number, z: number, rotY: number, scale: number, fade = true) {
    // E23.12.3: a tree or shrub tall enough to hide a cat, for the CPU line of sight
    if (SOLID_SINK.current) SOLID_SINK.current.foliage(foliageShapeOf(g), x, y, z, scale);
    const nv = g.pos.length / 4;
    const base = this.pos.n / 4;
    this.pos.reserve(nv * 4);
    this.nrm.reserve(nv * 3);
    this.col.reserve(nv * 4);
    this.tree.reserve(nv * 4);
    this.idx.reserve(g.idx.length);
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const P = this.pos.a, N = this.nrm.a, C = this.col.a, I = this.idx.a, T = this.tree.a;
    let p = this.pos.n, n = this.nrm.n, k = this.col.n, q4 = this.tree.n;
    const th = fade ? g.height * scale : 0;
    const grey = this.grey;
    for (let i = 0; i < nv; i++) {
      const px = g.pos[i * 4], py = g.pos[i * 4 + 1], pz = g.pos[i * 4 + 2];
      P[p++] = x + (px * c - pz * s) * scale;
      P[p++] = y + py * scale;
      P[p++] = z + (px * s + pz * c) * scale;
      P[p++] = g.pos[i * 4 + 3];
      const nx = g.nrm[i * 3], nz = g.nrm[i * 3 + 2];
      N[n++] = nx * c - nz * s;
      N[n++] = g.nrm[i * 3 + 1];
      N[n++] = nx * s + nz * c;
      let r = g.col[i * 4], gg = g.col[i * 4 + 1], b = g.col[i * 4 + 2];
      if (grey > 0) {
        const l = 0.3 * r + 0.59 * gg + 0.11 * b;
        r = r + (l * 0.85 - r) * grey;
        gg = gg + (l * 0.88 - gg) * grey;
        b = b + (l * 0.95 - b) * grey;
      }
      C[k++] = r;
      C[k++] = gg;
      C[k++] = b;
      C[k++] = 255;
      T[q4++] = x;
      T[q4++] = y;
      T[q4++] = z;
      T[q4++] = th;
    }
    this.tree.n = q4;
    this.pos.n = p;
    this.nrm.n = n;
    this.col.n = k;
    let q = this.idx.n;
    for (let i = 0; i < g.idx.length; i++) I[q++] = base + g.idx[i];
    this.idx.n = q;
    this.tris += g.tris;
  }

  build(device: pc.GraphicsDevice): pc.Mesh | undefined {
    if (!this.idx.n) return undefined;
    const m = new pc.Mesh(device);
    m.setPositions(this.pos.view(), 4);
    m.setNormals(this.nrm.view());
    m.setColors32(this.col.view());
    m.setVertexStream(pc.SEMANTIC_ATTR12, this.tree.view(), 4);
    m.setIndices(this.idx.view());
    m.update(pc.PRIMITIVE_TRIANGLES);
    // The engine's bounds assume 3-component positions; ours carry flex in the 4th, so set them ourselves
    // (padded for the wind sway), or the camera culls the trees while their shadows still draw.
    const P = this.pos.a;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.n; i += 4)
      for (let k = 0; k < 3; k++) {
        const v = P[i + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    const pad = 0.12;
    m.aabb = new pc.BoundingBox(
      new pc.Vec3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2),
      new pc.Vec3((hi[0] - lo[0]) / 2 + pad, (hi[1] - lo[1]) / 2 + pad, (hi[2] - lo[2]) / 2 + pad),
    );
    return m;
  }
}

/** One mesh per tree template, for the few trees that animate on their own (growing, showcase). */
const meshCache = new Map<TreeGeo, pc.Mesh>();
export function treeMesh(device: pc.GraphicsDevice, g: TreeGeo): pc.Mesh {
  let m = meshCache.get(g);
  if (!m) {
    const b = new FoliageBuilder();
    b.add(g, 0, 0, 0, 0, 1);
    m = b.build(device)!;
    // The cache owns a reference: otherwise the engine destroys the mesh when the last growing tree using it is
    // destroyed, and the next tree handed this cached mesh fails to render ("reading 'impl'").
    m.incRefCount();
    meshCache.set(g, m);
  }
  return m;
}

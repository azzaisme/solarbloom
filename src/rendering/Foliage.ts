import * as pc from 'playcanvas';
import type { TreeGeo } from './TreeGen';

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
uniform float uWindTime;
uniform float uWindStrength;
vec3 windOffset(vec3 posW, float flex) {
	if (flex <= 0.0) return vec3(0.0);
	float ph = dot(posW.xz, vec2(0.37, 0.21));
	float wave = uWindTime * 1.2 + ph - dot(posW.xz, vec2(0.8, -0.6)) * 0.35;
	float g = uWindStrength * (0.55 + 0.45 * sin(wave) + 0.22 * sin(wave * 2.3 + 1.3));
	vec3 o = vec3(0.8, 0.0, -0.6) * flex * g * 0.05;
	o += vec3(0.6, 0.0, 0.8) * flex * 0.012 * uWindStrength * sin(uWindTime * 1.9 + posW.y * 3.0 + ph);
	o += vec3(sin(uWindTime * 6.1 + ph * 13.0), 0.5 * sin(uWindTime * 7.7 + ph * 7.0), cos(uWindTime * 5.3 + ph * 11.0)) * flex * flex * 0.006 * uWindStrength;
	o.y -= flex * flex * g * g * 0.01;
	return o;
}
vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
	vec3 localPos = getLocalPosition(vertexPosition);
	vec4 posW = modelMatrix * vec4(localPos, 1.0);
	posW.xyz += windOffset(posW.xyz, vertex_position.w);
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

/** Declares the per-vertex tree attribute and the cursor uniforms. */
const TREE_USER_CODE = /* glsl */ `
attribute vec4 vertex_tree;
uniform vec4 uTreeCursor; // cursor in NDC (x, y), view depth of the ground under it, strength 0..1
uniform vec2 uTreeScreen; // canvas size in pixels
`;

/** Fades the vertex's alpha when its tree covers the cursor (forward pass; shadows ignore opacity). */
const TREE_MAIN_END = /* glsl */ `
	#ifdef VERTEX_COLOR
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
			// Canopies are roughly 0.42 of the height across; the trunk's foot needs less.
			float r = len * mix(0.18, 0.42, smoothstep(0.0, 0.45, t));
			float cover = 1.0 - smoothstep(r * 0.85, r * 1.25, d);
			vVertexColor.a *= 1.0 - 0.72 * cover * uTreeCursor.w;
		}
	}
	#endif
`;

let material: pc.StandardMaterial | undefined;
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
  m.opacityShadowDither = pc.DITHER_NONE;
  m.setAttribute('vertex_tree', pc.SEMANTIC_ATTR12);
  try {
    const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
    chunks.set('transformVS', WIND_TRANSFORM);
    chunks.set('litUserCodeVS', TREE_USER_CODE);
    chunks.set('litUserMainEndVS', TREE_MAIN_END);
  } catch {
    /* an engine without per-material chunks: trees simply don't sway or fade */
  }
  m.setParameter('uTreeCursor', [0, 0, 0, 0]);
  m.setParameter('uTreeScreen', [1, 1]);
  m.setParameter('uWindTime', 0);
  m.setParameter('uWindStrength', windStrength);
  m.update();
  return (material = m);
}

/** Advances the wind (once per frame). `strength` 0 = still (reduced motion). */
export function updateWind(time: number, strength = windStrength) {
  windStrength = strength;
  const m = foliageMaterial();
  m.setParameter('uWindTime', time);
  m.setParameter('uWindStrength', strength);
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
export class FoliageBuilder {
  private pos = new Grow(new Float32Array(1 << 14));
  private nrm = new Grow(new Float32Array(1 << 14));
  private col = new Grow(new Uint8Array(1 << 14));
  private tree = new Grow(new Float32Array(1 << 14));
  private idx = new Grow(new Uint32Array(1 << 14));
  /** 0 = full colour … 1 = grey (fog), as in the chunk builder */
  grey = 0;
  tris = 0;

  add(g: TreeGeo, x: number, y: number, z: number, rotY: number, scale: number) {
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
    const th = g.height * scale;
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

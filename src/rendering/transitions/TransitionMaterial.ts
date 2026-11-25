import * as pc from 'playcanvas';

/**
 * Look 6.12 (#181): the material every living transition is drawn with. Two kinds of geometry share it:
 *
 * - The **living surface**: one slab per ground tile (chunk meshes). Its fragment shader draws the tile's look from
 *   a few per-vertex numbers: grime and stains from pollution, a procedural crack network (Look 6.3), moss in the
 *   cracks and creeping across (6.14), the restore sequence's widening fracture, soil and knitting turf (6.4–6.6), the
 *   bloom colour shift (6.15) and the lush wet mask (6.16). Each blends from a "from" look to the vertex colour (the
 *   end state) by the transition's progress, through a mask that creeps in from the edge the change came from.
 * - **Transition decoration**: the props of tiles mid-transition (outgoing old props, incoming new ones, and
 *   transitional pieces: slab fragments, roots, seedlings). Its vertex shader grows, heaves, tilts and sinks each
 *   piece around its own anchor inside a progress window, so nothing pops.
 *
 * Progress is computed on the GPU from a global sim-time uniform and each vertex's start time and duration, so
 * thousands of tiles can be mid-transition with no per-frame CPU work; the CPU only rebuilds a chunk when a
 * transition starts or ends. Reduced motion keeps the timing but drops heave, tilt and overshoot. The Low tier
 * drops the procedural patterns (colour and mask fades only).
 *
 * Per-vertex data:
 *   trA = (t0, duration, mode, stagger)    mode 0 still · 1 grow · 2 heave (slab piece) · 3 surface · 4 root
 *   trB = deco: (inA, inB, outA, outB) progress windows · surface: (from colour packed, from pollution, to pollution, kind*8 + state)
 *   trC = deco: (anchor x, y, z, seed)                 · surface: (dir, feature, lushAt, lushUntil)
 *   Tree morph (mode 5) stores the starting vertex position in trB.xyz. Leaves follow the branch motion while
 *   their shape changes by trLeaf over their own opening window (trA.w to trB.w).
 * Surface kinds: 0 none · 1 soften · 2 moss · 3 restore · 4 bloom · 5 unblock. States: 0 concrete · 1 moss ·
 * 2 soil · 3 grass · 4 hard (water, clean paving: no cracks).
 */

export const SEM_A = pc.SEMANTIC_ATTR13;
export const SEM_B = pc.SEMANTIC_ATTR14;
export const SEM_C = pc.SEMANTIC_ATTR15;
export const SEM_LEAF = pc.SEMANTIC_ATTR12;

const DECL_VS = /* glsl */ `
attribute vec4 vertex_trA;
attribute vec4 vertex_trB;
attribute vec4 vertex_trC;
attribute vec3 vertex_trLeaf;
varying vec4 vTrA;
varying vec4 vTrB;
varying vec4 vTrC;
uniform float uTrTime;
uniform float uTrDurScale;
uniform float uTrMotion;
uniform vec4 uTrScrub;
`;

const TRANSFORM_VS = /* glsl */ `
#ifdef PIXELSNAP
uniform vec4 screen_size;
#endif
#ifdef SCREENSPACE
uniform float projectionFlipY;
#endif
float trProgressAt(vec4 a, vec3 anchorW) {
	float d = max(a.y * uTrDurScale, 0.001);
	float p = (uTrTime - a.x) / d;
	if (uTrScrub.w > 0.5 && floor(anchorW.x) == uTrScrub.x && floor(anchorW.z) == uTrScrub.y) p = uTrScrub.z;
	return p;
}
vec3 trDisplace(vec3 posW) {
	float mode = vertex_trA.z;
	if (mode < 0.5 || (mode > 2.5 && mode < 3.5)) return posW;
	vec3 anc = vertex_trC.xyz;
	float p = clamp(trProgressAt(vertex_trA, anc), 0.0, 1.0);
	if (mode > 4.5) {
		float growth = smoothstep(0.0, 1.0, p);
		vec3 moved = mix(vertex_trB.xyz, posW, growth);
		if (vertex_trB.w > 0.0) {
			float open = smoothstep(vertex_trA.w, vertex_trB.w, p);
			moved += vertex_trLeaf * (open - growth) * uTrMotion;
		}
		return moved;
	}
	// stagger: pieces start one after another inside their window
	float span = vertex_trB.y - vertex_trB.x;
	float q = p - vertex_trA.w * span * 0.6;
	float vin = vertex_trB.y <= vertex_trB.x ? 1.0 : smoothstep(vertex_trB.x, vertex_trB.y, q);
	float vout = vertex_trB.z >= 1.5 ? 0.0 : smoothstep(vertex_trB.z, vertex_trB.w, p);
	vec3 rel = posW - anc;
	if (mode < 1.5) {
		// grow from the anchor, with a soft overshoot (none with reduced motion)
		float v = vin * (1.0 - vout);
		float s = v + sin(v * 3.14159) * 0.12 * uTrMotion * (1.0 - vout);
		return anc + rel * s;
	}
	float seed = vertex_trC.w;
	if (mode < 2.5) {
		// slab piece: lifts and tilts as if pushed from below, then crumbles and sinks into the soil
		vec2 axis = vec2(cos(seed * 6.2831), sin(seed * 6.2831));
		float lift = vin * (1.0 - vout);
		float y = lift * (0.035 + 0.03 * fract(seed * 7.0)) * uTrMotion + dot(rel.xz, axis) * lift * 0.45 * uTrMotion;
		float sink = vout;
		vec3 r = rel * (1.0 - sink * 0.75);
		return anc + r + vec3(0.0, y - sink * 0.12, 0.0);
	}
	// root: grows up out of the cracks, curls, then is churned into the soil
	float g = vin;
	vec3 r = vec3(rel.x * (0.4 + 0.6 * g), rel.y * g, rel.z * (0.4 + 0.6 * g));
	r.x += sin(rel.y * 18.0 + seed * 9.0) * 0.02 * g * uTrMotion;
	return anc + r * (1.0 - vout * 0.6) - vec3(0.0, vout * 0.1, 0.0);
}
vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
	vec3 localPos = getLocalPosition(vertexPosition);
	vec4 posW = modelMatrix * vec4(localPos, 1.0);
	posW.xyz = trDisplace(posW.xyz);
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

const MAIN_END_VS = /* glsl */ `
	vTrA = vertex_trA;
	vTrB = vertex_trB;
	vTrC = vertex_trC;
`;

const DECL_PS = /* glsl */ `
varying vec4 vTrA;
varying vec4 vTrB;
varying vec4 vTrC;
uniform float uTrTime;
uniform float uTrDurScale;
uniform float uTrDetail;
uniform vec3 uTrSea;
uniform vec4 uTrScrub;
uniform vec4 uTrStages;
uniform vec3 uTrLush;
// Look 2 hook: transition colours come from PALETTE (linear), set by TransitionRenderer
uniform vec3 uTrSoil;
uniform vec3 uTrMoss;
uniform vec3 uTrCrack;
uniform vec3 uTrRust;
uniform vec3 uTrLife;
vec3 trGlow = vec3(0.0);
`;

/** Albedo for the living surface (and plain vertex colour for decoration). */
const DIFFUSE_PS = /* glsl */ `
uniform vec3 material_diffuse;
float trHash(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float trNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(trHash(i), trHash(i + vec2(1.0, 0.0)), f.x), mix(trHash(i + vec2(0.0, 1.0)), trHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 trUnpack(float c) {
	float r = mod(c, 256.0);
	float g = mod(floor(c / 256.0), 256.0);
	float b = floor(c / 65536.0);
	return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}
// Where a crack crosses a tile edge: shared by the two tiles on either side, so cracks connect across borders.
float trEdge(vec2 e, float axis) {
	return 0.28 + 0.44 * trHash(e * vec2(1.7, 3.1) + axis * 17.0);
}
// Distance to one warped crack running across the tile from (0, a) to (1, b) in (u, v) space; s = position along it.
float trCrack(vec2 uv, float a, float b, float seed, out float s) {
	s = uv.x;
	// The path wanders on two scales of value noise (plus a gentle sine), pinned to zero at the tile edges so the
	// edge points stay shared with the neighbours.
	float env = sin(uv.x * 3.14159);
	float c = mix(a, b, uv.x) + env * (
		0.05 * sin(uv.x * 9.0 + seed * 6.2831) +
		0.11 * (trNoise(vec2(uv.x * 5.0, seed * 31.0)) - 0.5) +
		0.045 * (trNoise(vec2(uv.x * 17.0, seed * 57.0 + 3.0)) - 0.5) +
		0.015 * (trNoise(vec2(uv.x * 46.0, seed * 91.0 + 7.0)) - 0.5));
	// Width varies along the crack: hairline stretches, then wider gaps.
	float wv = 0.4 + 1.2 * trNoise(vec2(uv.x * 7.0 + seed * 13.0, seed * 5.0));
	return abs(uv.y - c) / wv;
}
// How far along a crack is from where the change came in (0 = first to crack).
float trReveal(float s, float dir, float lo, float hi) {
	if (dir > lo - 0.5 && dir < lo + 0.5) return s;
	if (dir > hi - 0.5 && dir < hi + 0.5) return 1.0 - s;
	return 0.25 + abs(s - 0.5);
}
// Crack network: the main cracks (W-E and S-N, edge points shared with neighbours) and a branch. Returns the
// distance to the nearest revealed crack (large when none is revealed yet).
float trCracks(vec2 cell, vec2 l, float dir, float reveal) {
	float seed = trHash(cell + 0.37);
	float s;
	float best = 9.0;
	float dA = trCrack(l, trEdge(cell, 0.0), trEdge(cell + vec2(1.0, 0.0), 0.0), seed, s);
	if (trReveal(s, dir, 2.0, 1.0) < reveal * 1.25) best = min(best, dA);
	float dB = trCrack(l.yx, trEdge(cell, 1.0), trEdge(cell + vec2(0.0, 1.0), 1.0), seed + 0.5, s);
	if (trReveal(s, dir, 4.0, 3.0) < reveal * 1.25) best = min(best, dB);
	// a hairline branch from the west edge toward the middle, revealed late
	vec2 bl = vec2(l.x * 1.6, l.y);
	float dC = trCrack(bl, trEdge(cell, 2.0), 0.5 + 0.3 * (seed - 0.5), seed + 0.25, s);
	if (l.x < 0.62 && reveal > 0.45 && s < (reveal - 0.45) * 2.5) best = min(best, dC * 1.3);
	return best;
}
// Creep mask: 1 where the change has reached, spreading from the source edge (dir) with a noisy front.
float trCreep(vec2 l, float dir, float p, float n) {
	float d;
	if (dir < 0.5) d = length(l - 0.5) * 1.41;
	else if (dir < 1.5) d = 1.0 - l.x;
	else if (dir < 2.5) d = l.x;
	else if (dir < 3.5) d = 1.0 - l.y;
	else d = l.y;
	float front = p * 1.4 - 0.2;
	// two octaves on the front: broad lobes plus a ragged fringe
	float n2 = uTrDetail > 0.5 ? trNoise(l * 13.0 + n * 7.0) : 0.5;
	return 1.0 - smoothstep(front - 0.06, front + 0.06, d + (n - 0.5) * 0.4 + (n2 - 0.5) * 0.16);
}
float trWin(float p, vec2 w) {
	return clamp((p - w.x) / max(w.y - w.x, 0.0001), 0.0, 1.0);
}
void getAlbedo() {
	dAlbedo = material_diffuse.rgb;
	#ifdef STD_DIFFUSE_VERTEX
		dAlbedo *= saturate(vVertexColor.rgb);
	#endif
	if (vTrA.z < 2.5 || vTrA.z > 3.5) return;
	// E27.1 (#679): the open sea's day lift fades back out by night (Water.seaTintAt)
	if (vTrC.y > 7.5) dAlbedo *= uTrSea;
	vec3 to = dAlbedo;
	vec2 cell = floor(vPositionW.xz + 0.0001);
	vec2 l = vPositionW.xz - cell;
	float p = clamp((uTrTime - vTrA.x) / max(vTrA.y * uTrDurScale, 0.001), 0.0, 1.0);
	if (uTrScrub.w > 0.5 && cell.x == uTrScrub.x && cell.y == uTrScrub.y) p = uTrScrub.z;
	float code = vTrB.w;
	float kind = floor(code / 8.0 + 0.01);
	float state = code - kind * 8.0;
	if (kind < 0.5) p = 1.0;
	bool top = vNormalW.y > 0.5;
	// Settled living or hard ground (most of a restored city), or any slab side: just its colour, unless it's lush.
	bool wetNow = vTrC.w > uTrTime;
	if (kind < 0.5 && (state > 1.5 || !top) && !(wetNow && top)) return;
	vec3 from = kind < 0.5 ? to : trUnpack(vTrB.x);
	float dir = vTrC.x;
	float detail = uTrDetail;
	float n = detail > 0.5 && kind > 0.5 ? trNoise(l * 5.0 + cell * 1.7) : 0.5;
	float creep = trCreep(l, dir, p, n);
	vec3 col = to;
	vec3 soil = uTrSoil * 0.55;
	vec3 moss = uTrMoss * 0.8;
	vec3 crackCol = uTrCrack * 0.55;
	float glow = 0.0;
	// pollution now (soften eases it in from the source edge)
	float pol = kind > 0.5 && kind < 2.5 ? mix(vTrB.y, vTrB.z, creep) : vTrB.z;
	float feat = vTrC.y;
	if (kind > 2.5 && kind < 3.5 && feat > 2.5 && feat < 3.5) {
		// ── water (Look 6.17): murky brown-grey clears to blue from the inflow side, with a shimmer at the front ──
		float c = trCreep(l, dir, p, n);
		col = mix(from, to, c);
		col += vec3(0.05, 0.09, 0.1) * c * (1.0 - c) * 3.0 * (0.6 + 0.4 * sin(l.x * 20.0 + uTrTime * 3.0));
	} else if (kind > 2.5 && kind < 3.5 && feat > 0.5 && feat < 1.5) {
		// ── paving (Look 6.17): grime washes off slab by slab, the joints fill with moss; it stays stone ──
		float c = trCreep(l, dir, p, n);
		col = mix(from, to, smoothstep(0.0, 1.0, c));
		if (detail > 0.5) {
			float d = trCracks(cell, l, dir, 1.0);
			float joint = 1.0 - smoothstep(0.012, 0.03, d);
			float m = smoothstep(0.2, 0.7, p);
			col = mix(col, mix(crackCol, moss * 1.4, m), joint * (1.0 - smoothstep(0.85, 1.0, p) * 0.6));
		}
	} else if (kind > 2.5 && kind < 3.5) {
		// ── restore: fracture → heave → crumble to soil → sprout → knit ──
		float fr = trWin(p, uTrStages.xy);
		float cr = trWin(p, vec2(uTrStages.y, uTrStages.z));
		float kn = trWin(p, vec2(uTrStages.w, 1.0));
		float d = detail > 0.5 ? trCracks(cell, l, dir, 1.0) : abs(l.y - 0.5);
		float w = 0.01 + 0.04 * fr + 0.7 * cr * cr;
		float inCrack = 1.0 - smoothstep(w * 0.6, w, d + (n - 0.5) * 0.06 * cr);
		vec3 slab = mix(from, from * 0.85, 0.3);
		col = mix(slab, soil, inCrack);
		if (cr > 0.98) col = soil;
		// soil gets clods
		col *= 0.85 + 0.3 * trNoise(l * 14.0 + cell);
		// turf knits from the cracks and the edges
		// roads (Look 6.17): green verges creep in from both kerbs rather than from every edge
		float edge = feat > 1.5 && feat < 2.5 ? min(l.x, 1.0 - l.x) : min(min(l.x, 1.0 - l.x), min(l.y, 1.0 - l.y));
		float knit = smoothstep(kn * 1.2 - 0.1, kn * 1.2 + 0.05, min(d * 1.6, edge * 2.2) + (n - 0.5) * 0.3);
		col = mix(col, to, (1.0 - knit) * step(0.001, kn));
		if (kn >= 1.0) col = to;
		// the first fracture flashes green-gold (life underneath)
		glow = (1.0 - smoothstep(0.0, 1.0, fr)) * step(0.0001, p) * inCrack * 1.6 + inCrack * (1.0 - smoothstep(0.0, 0.3, cr)) * 0.06;
	} else if (state < 0.5 || state > 0.5 && state < 1.5) {
		// ── concrete (polluted) and moss (prepared): grime, cracks, moss ──
		float g = pol / 100.0;
		float base = state > 0.5 ? 1.0 : 0.0;
		float m = kind > 1.5 && kind < 2.5 ? creep : base;
		vec3 c = mix(from, to, kind > 1.5 && kind < 2.5 ? creep : (kind > 4.5 ? creep : 1.0));
		if (detail > 0.5 && state < 0.5) {
			float stain = smoothstep(0.45, 0.75, trNoise(l * 3.0 + cell * 0.9));
			c *= 1.0 - 0.38 * g * stain;
			float rust = smoothstep(0.86, 0.95, trNoise(vec2(l.x * 9.0, l.y * 1.5) + cell));
			c = mix(c, uTrRust * 0.55, rust * g * 0.5);
			// pale, clean limestone as the grime goes
			c = mix(c, c * 1.18 + 0.02, (1.0 - g) * 0.6);
		}
		col = c;
		if (detail > 0.5 && top) {
			float reveal = state > 0.5 ? 1.0 : 0.12 + 0.88 * (1.0 - g);
			// Look 6.7: next to living ground, hairline cracks reach in from that side even on grimy concrete
			if (dir > 0.5) reveal = max(reveal, 0.45);
			float d = trCracks(cell, l, dir, reveal);
			float w = 0.008 + 0.012 * (1.0 - g) + 0.012 * m;
			float rough = (trNoise(l * 38.0 + cell) - 0.5) * w * 0.7; // ragged crack edges
			float inCrack = 1.0 - smoothstep(w * 0.5, w, d + rough);
			float lip = (1.0 - smoothstep(w, w * 2.2, d)) * (1.0 - inCrack);
			vec3 cc = mix(crackCol, moss * 1.3, m);
			col = mix(col * (1.0 + 0.12 * lip), cc, inCrack);
			glow += inCrack * (1.0 - m) * (1.0 - g) * 0.18;
			// moss patches spread out from the cracks with a fuzzy edge
			float patchN = 0.65 * trNoise(l * 7.0 + cell * 2.3) + 0.35 * trNoise(l * 19.0 + cell * 4.1);
			float cover = m * smoothstep(0.75, 0.25, patchN - (0.18 - d) * 1.5);
			col = mix(col, moss * (0.85 + 0.4 * patchN), cover * 0.75);
			// the creeping front itself is fresh moss green
			if (kind > 1.5 && kind < 2.5) col = mix(col, moss * 1.5, (creep * (1.0 - creep)) * 2.4);
		}
	} else if (kind > 3.5 && kind < 4.5) {
		// ── bloom: the grass deepens from patches outward ──
		float m = smoothstep(p * 1.3 - 0.15, p * 1.3, (detail > 0.5 ? trNoise(l * 4.0 + cell) : 0.5) * 0.7 + length(l - 0.5) * 0.5);
		col = mix(to, from, m);
	} else if (kind > 0.5) {
		col = mix(from, to, creep);
	}
	// ── lush: soaks in, then dries back before the bonus ends ──
	float lushAt = vTrC.z;
	float lushUntil = vTrC.w;
	if (lushUntil > uTrTime && top) {
		float soak = clamp((uTrTime - lushAt) / uTrLush.x, 0.0, 1.0);
		float dry = clamp((lushUntil - uTrTime) / uTrLush.y, 0.0, 1.0);
		float wn = detail > 0.5 ? trNoise(l * 4.0 + cell * 3.0) : 0.5;
		float wet = smoothstep(wn * 0.6, wn * 0.6 + 0.25, soak) * smoothstep(wn * 0.5, wn * 0.5 + 0.3, dry);
		col = mix(col, col * vec3(0.42, 0.55, 0.62), wet);
		if (detail > 0.5) {
			float sp = trHash(floor(l * 22.0) + cell * 13.0 + floor(uTrTime * 1.5));
			glow += step(0.992, sp) * wet * 2.0;
		}
	}
	dAlbedo = col;
	trGlow = uTrLife * glow;
}
`;

const EMISSIVE_PS = /* glsl */ `
uniform float material_emissiveIntensity;
void getEmission() {
	dEmission = trGlow * material_emissiveIntensity;
}
`;

let material: pc.StandardMaterial | undefined;

/** The shared transition material (living surfaces and transition decoration of every chunk). */
export function transitionMaterial(): pc.StandardMaterial {
  if (material) return material;
  const m = new pc.StandardMaterial();
  m.name = 'look6-transitions';
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseVertexColor = true;
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = 0.3;
  m.emissive = new pc.Color(1, 1, 1);
  m.emissiveIntensity = 1;
  m.setAttribute('vertex_trA', SEM_A);
  m.setAttribute('vertex_trB', SEM_B);
  m.setAttribute('vertex_trC', SEM_C);
  m.setAttribute('vertex_trLeaf', SEM_LEAF);
  try {
    const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
    chunks.set('litUserDeclarationVS', DECL_VS);
    chunks.set('transformVS', TRANSFORM_VS);
    chunks.set('litUserMainEndVS', MAIN_END_VS);
    chunks.set('litUserDeclarationPS', DECL_PS);
    chunks.set('diffusePS', DIFFUSE_PS);
    chunks.set('emissivePS', EMISSIVE_PS);
  } catch {
    /* an engine without per-material chunks: tiles still draw in their end state */
  }
  m.setParameter('uTrTime', 0);
  m.setParameter('uTrDurScale', 1);
  m.setParameter('uTrMotion', 1);
  m.setParameter('uTrDetail', 1);
  m.setParameter('uTrScrub', [0, 0, 0, 0]);
  m.setParameter('uTrStages', [0.08, 0.3, 0.5, 0.7]);
  m.setParameter('uTrLush', [2.5, 10, 0]);
  for (const u of ['uTrSoil', 'uTrMoss', 'uTrCrack', 'uTrRust', 'uTrLife']) m.setParameter(u, [0.5, 0.5, 0.5]);
  m.update();
  return (material = m);
}

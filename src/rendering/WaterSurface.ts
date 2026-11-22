import * as pc from 'playcanvas';
import { LOOK } from '../data/look';
import { coverDistance, nearestWaterCovers, nearestWaterDisturbers, waterCovers, waterDisturberVersion, type WaterCover } from './WaterDisturbance';

/**
 * E28.W01 (#694): the water. One surface and one material for every stretch of live water: the open sea and its
 * shallows, the beach's surf (murky while dead, clear once restored) and restored pools and ponds. It replaces the
 * flat per-tile slabs (which stay underneath as the sea bed and the restoration state) and the old pool shader.
 *
 * Each vertex carries how far it lies from land (red, 0 … WATER_ENC tiles), how clear the water is (green, 0 murky
 * … 1 clear), the clarity before a restore (blue) and how far a bank pulled the edge out (alpha). From those:
 * - the surface moves: a few long, low waves, each with its own direction, wavelength, phase and speed, lift and lower
 *   it (vertex shader), easing in from the waterline so the shore stays put. The fragment shader works out the same
 *   waves' slope, so the normal follows them exactly;
 * - small ripples: two normal maps (made here, tileable) scrolling in different directions, their reading bent by the
 *   large waves. They're mipmapped, and each texel also carries its slope's spread, so far off they average to a
 *   calm surface whose highlight widens (specular anti-aliasing) instead of sparkling;
 * - rings: now and then a ripple runs out round something standing in the water (WaterDisturbance), and gentle
 *   ripples travel in toward every shore;
 * - colour by depth: shallow turquoise to deep teal-blue, a smooth blend by distance from land, with the sand bed
 *   and light nets through the shallows and murky green-grey for dead surf. No wave stripes are painted into it:
 *   the waves show through the light and the reflections alone;
 * - lighting: the engine's sun (or moon) and lights on that normal, a sharp but soft-capped highlight, and crisp
 *   glint shapes where the surface turns the sun toward the eye;
 * - reflection by Fresnel: the sky's colours on every tier, and on High a planar reflection of the world
 *   (WaterReflection), broken up by the same normal.
 * Everything is a named value in LOOK.water. WebGL2 only (as the rest of the look); WebGPU keeps plain lit water.
 */

/** Distance to land (tiles) encoded in a vertex's red channel: 0 … WATER_ENC */
export const WATER_ENC = 8;

/** How clear a live water tile is: dead surf is murky; the sea, restored water and ponds are clear. */
export const WATER_CLARITY = { murky: 0.3, clear: 1 } as const;

/**
 * A water vertex's colour bytes: distance to land (red), clarity (green) and the clarity before a restore still
 * playing on it (blue; the same as green when there's none). Its uv0 carries that restore's window on the transition
 * clock (start, length), and the shader fades blue to green over it, in step with the tile's own transition.
 */
export function encodeWater(dist: number, clarity: number, from = clarity, shore = 0): [number, number, number, number] {
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const r = Math.round((Math.min(WATER_ENC, Math.max(0, dist)) / WATER_ENC) * 255);
  // E28.W02: alpha carries how far a bank has pulled the water's edge out here (tiles, up to WATER_SHORE_ENC; 255 = none)
  return [r, byte(clarity), byte(from), 255 - byte(shore / WATER_SHORE_ENC)];
}

/**
 * E28.W02 (#695): the most a bank pulls the water's edge out (tiles), as the alpha channel carries it. `dist` (red) is
 * the distance to the bank's own waterline, where the foam's contact edge lies; the colour by depth, the sand bed, the
 * shore waves and the foam lines go by that distance plus (1 - `LOOK.shore.waterPull`) of the pull, so they follow the
 * new outline without crowding a narrow canal with foam.
 */
export const WATER_SHORE_ENC = 1;

/** How far a restore's clarity fade has got (0 … 1, eased), as the shader works it out. */
export function waterFade(time: number, t0: number, d: number): number {
  const x = Math.min(1, Math.max(0, (time - t0) / Math.max(d, 1e-3)));
  return x * x * (3 - 2 * x);
}

/** Whether the planar reflection runs: on the tiers that ask for it (High), never on the Steam Deck preset. */
export function waterReflectOn(tier: keyof typeof LOOK.tiers, deck: boolean): boolean {
  return !!LOOK.tiers[tier]?.waterReflect && !deck;
}

/** GLSL's smoothstep */
function ss(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The water's colour by depth (linear), as the shader blends it before bed, foam and light (tests and tuning). */
export function waterColourAt(dist: number): [number, number, number] {
  const W = LOOK.water;
  const s = lin3(W.shallow);
  const d = lin3(W.deep);
  const k = ss(0, W.deepAt, dist);
  return [0, 1, 2].map((i) => s[i] + (d[i] - s[i]) * k) as [number, number, number];
}

/** Fresnel reflectance at a view angle (cosine between the view and the surface normal), as the shader does it. */
export function waterFresnel(ndv: number): number {
  const F = LOOK.water.fresnel;
  const f = F.base + (1 - F.base) * Math.pow(1 - Math.min(1, Math.max(0, ndv)), F.power);
  return Math.min(F.max, f);
}

function lin3(hex: string): [number, number, number] {
  const c = new pc.Color().fromString(hex);
  return [Math.pow(c.r, 2.2), Math.pow(c.g, 2.2), Math.pow(c.b, 2.2)];
}

/** One large wave as the shader takes it: unit direction, wavenumber (2π / length), height, angular speed, phase. */
export function waveParams(w: { angle: number; length: number; amp: number; speed: number; phase: number }) {
  const a = (w.angle * Math.PI) / 180;
  const k = (2 * Math.PI) / Math.max(0.05, w.length);
  return { dx: Math.cos(a), dz: Math.sin(a), k, amp: w.amp, omega: k * w.speed, phase: w.phase };
}

/**
 * The large waves' height above the water's rest level at a point, as the vertex shader lifts it (for tests): the
 * waves ride on their own summed height, so the surface only ever rises (the slab under it never shows through a
 * trough), and they ease in over `LOOK.water.waves.shore` from the waterline.
 */
export function waterWaves(x: number, z: number, t: number, edgeDist: number, covers: readonly WaterCover[] = waterCovers()): number {
  const W = LOOK.water.waves;
  let h = 0;
  for (const w of W.list) {
    const p = waveParams(w);
    h += p.amp * (1 + Math.sin((p.dx * x + p.dz * z) * p.k + t * p.omega + p.phase));
  }
  return h * ss(0, W.shore, edgeDist) * waterCalm(x, z, covers);
}

/** The most covers the shader lays the swell flat under at once. */
export const COVER_MAX = 4;

/** How much of the swell stands at (x, z): 0 under a cover (a deck low over the water), easing back to 1 round it. */
export function waterCalm(x: number, z: number, covers: readonly WaterCover[] = waterCovers()): number {
  let k = 1;
  for (const c of covers) k *= ss(0, LOOK.water.waves.coverEase, coverDistance(c, x, z));
  return k;
}

/** The line in the engine's own vertex transform after which the waves lift the surface. */
export const WAVES_ANCHOR = 'vec4 posW = modelMatrix * vec4(localPos, 1.0);';

/** The large waves, shared by the vertex shader (the lift) and the fragment shader (the slope it gives the light). */
const WAVES_GLSL = /* glsl */ `
uniform vec4 uWaterWave0; // direction x, z, wavenumber, height
uniform vec4 uWaterWave1;
uniform vec4 uWaterWave2;
uniform vec4 uWaterWave3;
uniform vec4 uWaterWaveW; // the four waves' angular speeds
uniform vec4 uWaterWaveP; // and phases
uniform vec4 uWaterWaveE; // ease-in distance from the waterline, the wave fade's two ends (pixels per wavelength, as 1/x), the ease round a cover
uniform vec4 uWaterCover[${COVER_MAX}]; // decks low over the water (x0, z0, x1, z1): the swell lies flat under them
uniform float uWaterCoverN;
// one wave: its height (x) and slope (yz). Its slope fades once a wavelength is too few pixels to draw (px: units a pixel)
vec3 sbWaveC(vec4 w, float om, float ph, vec2 p, float t, float px) {
	float a = dot(w.xy, p) * w.z + t * om + ph;
	float fade = px > 0.0 ? 1.0 - smoothstep(uWaterWaveE.y, uWaterWaveE.z, px * w.z / 6.2831853) : 1.0;
	return vec3(w.w * (1.0 + sin(a)), w.xy * (w.z * w.w * cos(a) * fade));
}
vec3 sbWaves(vec2 p, float t, float edgeDist, float px) {
	vec3 r = sbWaveC(uWaterWave0, uWaterWaveW.x, uWaterWaveP.x, p, t, px);
	r += sbWaveC(uWaterWave1, uWaterWaveW.y, uWaterWaveP.y, p, t, px);
	r += sbWaveC(uWaterWave2, uWaterWaveW.z, uWaterWaveP.z, p, t, px);
	r += sbWaveC(uWaterWave3, uWaterWaveW.w, uWaterWaveP.w, p, t, px);
	float calm = smoothstep(0.0, uWaterWaveE.x, edgeDist);
	for (int i = 0; i < ${COVER_MAX}; i++) {
		if (float(i) >= uWaterCoverN) break;
		vec4 c = uWaterCover[i];
		vec2 d = max(max(c.xy - p, p - c.zw), vec2(0.0));
		calm *= smoothstep(0.0, uWaterWaveE.w, length(d));
	}
	return r * calm;
}
`;

/** The most disturbers the shader rings round at once. */
export const DISTURB_MAX = 16;

/** E28.W05 (#698): the most lamps the water reflects at once (the nearest where the camera looks). */
export const LAMP_MAX = 8;

const WATER_COMMON = /* glsl */ `
uniform float uWaterTime;
uniform vec3 uWaterCam;
uniform vec3 uWaterShallow;
uniform vec3 uWaterDeep;
uniform vec3 uWaterMurky;
uniform vec3 uWaterBed;
uniform vec3 uWaterFoam;
uniform vec3 uWaterNight;
uniform vec4 uWaterDepth;  // (unused), deepAt, bedReach, bedShow
uniform vec4 uWaterLap;    // reach, length, speed, strength
uniform vec4 uWaterFoamL;  // reach, lines, speed, strength
uniform float uWaterShore; // E28.W02: the share of a bank's pull the colour, bed, waves and foam lines don't follow
uniform vec4 uWaterFres;   // base, power, max, sky
uniform float uWaterAmbient;
uniform float uWaterReflTint;
uniform vec4 uWaterRefl;   // strength (0 = off), distort, the reflected plane's height
uniform vec3 uWaterUnder;  // E28.W03: the shade under a deck: how much darker, how far in under its edge, how far out past it
uniform vec4 uWaterMisc;   // caustics, night, nightAlbedo, gloss
uniform float uWaterTrTime; // the transition clock (TransitionRenderer.time)
uniform vec3 uWaterSkyLow;
uniform vec3 uWaterSkyHigh;
uniform sampler2D uWaterReflectTex;
uniform mat4 uWaterReflectVP;
uniform sampler2D uWaterRip0;
uniform sampler2D uWaterRip1;
uniform vec4 uWaterRipA;   // map 0: 1 / size, then its drift (texture units a second) x, z
uniform vec4 uWaterRipB;   // map 1: the same, then its turn (cos, as the drift's own w)
uniform vec4 uWaterRipC;   // strength, distort, map 1's turn (sin), the maps' slope scale
uniform vec4 uWaterObs[${DISTURB_MAX}]; // things in the water: x, z, radius, strength
uniform vec4 uWaterObsK;   // how many, rate, reach, ring spacing
uniform vec2 uWaterObsW;   // ring width, strength
uniform vec4 uWaterGlint;  // cut, softness, strength, the moon's boost by night
uniform vec3 uWaterLightDir;  // toward the sun (or moon)
uniform vec3 uWaterLightCol;  // its colour × strength (linear)
uniform vec4 uWaterLamp[${LAMP_MAX}];  // E28.W05: lamps shining: x, y, z (the bulb), how strongly (0 … 1)
uniform vec3 uWaterLampC[${LAMP_MAX}]; // their colours (linear)
uniform vec4 uWaterLampK; // how many, the streak's width, the sheen's width, reach
uniform vec2 uWaterLampS; // the streak's strength, the sheen's
uniform vec4 uWaterAA;    // variance gain, the ripples' fade (pixels per ripple, as 1/x: from, to), a typical ripple's length
vec3 wNormal;
vec3 wEmit;
float wFoam;
float wGloss;
${WAVES_GLSL}
float sbWaterHash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float sbWaterNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(sbWaterHash(i), sbWaterHash(i + vec2(1.0, 0.0)), u.x), mix(sbWaterHash(i + vec2(0.0, 1.0)), sbWaterHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// one ripple map read: its mean slope (xy, world units) and how much the slope spreads within the texels read (z)
vec3 sbRipple(sampler2D tex, vec2 uv) {
	vec4 v = texture2D(tex, uv);
	vec2 s = (v.rg * 2.0 - 1.0) * uWaterRipC.w;
	float e2 = v.b * 2.0 * uWaterRipC.w * uWaterRipC.w;
	return vec3(s, max(0.0, e2 - dot(s, s)));
}
// light nets on the bed (as the old pool's caustics)
float sbWaterCaustic(vec2 p, float t) {
	// continuous (no wrap): a wrapped pattern leaves a seam at every period
	vec2 cp = p * 1.9 * 6.2831853 - 250.0;
	vec2 ci = cp;
	float cs = 1.0;
	for (int n = 0; n < 3; n++) {
		float ct = t * 0.5 * (1.0 - 3.5 / float(n + 1));
		ci = cp + vec2(cos(ct - ci.x) + sin(ct + ci.y), sin(ct - ci.y) + cos(ct + ci.x));
		cs += 1.0 / length(vec2(cp.x / (sin(ci.x + ct) / 0.005), cp.y / (cos(ci.y + ct) / 0.005)));
	}
	return clamp(pow(abs(1.17 - pow(cs / 3.0, 1.4)), 8.0), 0.0, 1.0);
}
void sbWaterSetup() {
	vec2 p = vPositionW.xz;
	float t = uWaterTime;
	float edgeDist = 0.0;
	float clarity = 1.0;
	float shorePull = 0.0;
	#ifdef STD_DIFFUSE_VERTEX
		edgeDist = vVertexColor.r * ${WATER_ENC.toFixed(1)};
		shorePull = (1.0 - vVertexColor.a) * ${WATER_SHORE_ENC.toFixed(1)};
		clarity = vVertexColor.g;
		#ifdef STD_AO
			// a restore still playing: the clarity before it (blue) fades to now (green) over its window (uv0)
			clarity = mix(vVertexColor.b, clarity, smoothstep(0.0, 1.0, (uWaterTrTime - vUv0.x) / max(vUv0.y, 1e-3)));
		#endif
	#endif
	// E28.W02: the foam's contact edge sits on a bank's own waterline (edgeDist); everything else keeps part of the
	// distance the bank took (uWaterShore), so a narrow canal keeps its clear middle
	float dist = edgeDist + shorePull * uWaterShore;
	float px = length(fwidth(p));
	// ── the large waves: their slope (the vertex shader lifts the surface by the same waves) ──
	vec3 big = sbWaves(p, t, edgeDist, px);
	vec2 g = big.yz;
	// ── small ripples: two maps drifting different ways, read where the large waves bend them ──
	vec2 bend = g * uWaterRipC.y;
	vec3 r0 = sbRipple(uWaterRip0, p * uWaterRipA.x + uWaterRipA.yz * t + bend);
	mat2 turn = mat2(uWaterRipB.w, uWaterRipC.z, -uWaterRipC.z, uWaterRipB.w);
	vec3 r1 = sbRipple(uWaterRip1, (turn * p) * uWaterRipB.x + uWaterRipB.yz * t - bend);
	// (map 1 is read turned: its slope turns back into the world)
	vec2 s1 = r1.xy * turn;
	// murky water lies flatter
	float rs = uWaterRipC.x * mix(0.6, 1.0, clarity);
	// far off, once a typical ripple is only a few pixels long, its slope fades and turns into spread: the surface
	// reads calm and the highlight widens, rather than single texels catching the sun or moon (the maps' filtering
	// keeps detail sharper than a pixel along the view at grazing angles)
	float keep = 1.0 - smoothstep(uWaterAA.y, uWaterAA.z, px / uWaterAA.w);
	vec2 gr = (r0.xy + s1) * rs * keep;
	float spread = (r0.z + r1.z + (dot(r0.xy, r0.xy) + dot(s1, s1)) * (1.0 - keep * keep)) * rs * rs;
	// ── gentle ripples travelling in toward every shore ──
	vec2 dd = vec2(dFdx(dist), dFdy(dist));
	vec2 jx = dFdx(p);
	vec2 jy = dFdy(p);
	float det = jx.x * jy.y - jx.y * jy.x;
	vec2 gd = abs(det) > 1e-8 ? vec2(dd.x * jy.y - dd.y * jx.y, dd.y * jx.x - dd.x * jy.x) / det : vec2(0.0);
	float lapK = 6.2831853 / max(uWaterLap.y, 0.05);
	float near = 1.0 - smoothstep(0.0, uWaterLap.x, dist);
	// (these fade early, from 20 pixels a wave down to 7: their direction comes from the distance field, which is
	// flat across each mesh cell, so far away they'd show the cells as steps)
	float lapFade = 1.0 - smoothstep(0.05, 0.14, px * lapK / 6.2831853);
	gr += gd * (cos(dist * lapK + t * uWaterLap.z * lapK) * lapK * 0.02 * uWaterLap.w * near * lapFade * mix(0.6, 1.0, clarity));
	// ── rings now and then round things standing in the water (rocks, posts, supports) ──
	for (int i = 0; i < ${DISTURB_MAX}; i++) {
		if (float(i) >= uWaterObsK.x) break;
		vec4 o = uWaterObs[i];
		vec2 dv = p - o.xy;
		float rr = length(dv);
		float d = rr - o.z;
		if (d < 0.0 || d > uWaterObsK.z || rr < 1e-4) continue;
		// each one starts a ring at its own time; it runs out to the reach, fading as it goes
		float cyc = fract(t * uWaterObsK.y + sbWaterHash(o.xy));
		float front = cyc * uWaterObsK.z;
		float x = (d - front) / uWaterObsW.x;
		float env = exp(-x * x) * (1.0 - cyc) * (1.0 - cyc) * o.w;
		float k = 6.2831853 / uWaterObsK.w;
		float dh = -sin((d - front) * k) * k * env;
		// (fading by the pixel's footprint across the ring, outward: along the view a pixel spans far more water, which
		// would wipe out every ring seen at a slant; from 10 pixels a wave down to 4)
		vec2 dir = dv / rr;
		float pxr = abs(dot(dir, jx)) + abs(dot(dir, jy));
		float ringFade = 1.0 - smoothstep(0.1, 0.25, pxr * k / 6.2831853);
		gr += dir * dh * uWaterObsW.y * 0.1 * ringFade;
	}
	g += gr;
	wNormal = normalize(vec3(-g.x, 1.0, -g.y));
	// specular anti-aliasing (Kaplanyan / Toksvig): how much the normal varies within a pixel (the ripple maps' own
	// spread, and the large waves' change across it) widens the highlight, so detail too fine to draw merges into a
	// soft sun or moon path instead of crawling single-pixel specks
	vec2 gx = dFdx(big.yz);
	vec2 gy = dFdy(big.yz);
	float vary = spread + dot(gx, gx) + dot(gy, gy);
	float rough = 1.0 - uWaterMisc.w;
	wGloss = 1.0 - sqrt(min(1.0, rough * rough + min(uWaterAA.x * vary, 0.35)));
	// ── colour by depth: turquoise by the shore, deep teal-blue far out, blended smoothly ──
	vec3 c = mix(uWaterShallow, uWaterDeep, smoothstep(0.0, uWaterDepth.y, dist));
	// the sand bed, and light nets on it, through the clear shallows (shifted by the ripples)
	float bedK = (1.0 - smoothstep(0.0, uWaterDepth.z, dist)) * uWaterDepth.w * clarity;
	// two layers at different scales and angles, so the nets never line up into a grid; only where the bed shows
	// (most of the screen is open water, which skips them)
	if (bedK > 0.001) {
		float caus = 0.0;
		if (uWaterMisc.x > 0.0) {
			vec2 pc1 = p * 2.6 + wNormal.xz * 0.6;
			vec2 pc2 = mat2(0.8, -0.6, 0.6, 0.8) * p * 1.9 + vec2(3.7, 1.9) + wNormal.xz * 0.6;
			caus = 0.6 * (sbWaterCaustic(pc1, t) + sbWaterCaustic(pc2, t * 0.83)) * uWaterMisc.x;
		}
		c = mix(c, uWaterBed * (1.0 + caus * 1.5), bedK);
	}
	c = mix(uWaterMurky, c, clarity);
	// ── foam: an edge on the shore and lines lapping in, broken up so it never rings in perfect contours ──
	// (only near the shore: further out there is none, and the noise is skipped)
	float fr = max(uWaterFoamL.x, 0.05);
	wFoam = 0.0;
	if (edgeDist < fr * 2.0) {
		float n1 = sbWaterNoise(p * 2.3 + vec2(t * 0.11, -t * 0.07));
		float n2 = sbWaterNoise(p * 5.1 - vec2(t * 0.05, t * 0.09));
		float edge = 1.0 - smoothstep(0.02, 0.09 + 0.05 * n1, edgeDist);
		float band = fract(dist / fr * uWaterFoamL.y + t * uWaterFoamL.z + n1 * 0.35);
		float lines = smoothstep(0.72, 0.9, band) * (1.0 - smoothstep(0.9, 1.0, band)) * (1.0 - smoothstep(0.0, fr * 2.0, dist));
		wFoam = clamp((edge + lines * 0.7) * smoothstep(0.25, 0.65, n2 + 0.25 * edge) * uWaterFoamL.w, 0.0, 1.0) * mix(0.5, 1.0, clarity);
	}
	// ── Fresnel: the sky (and, on High, the world) reflected, more toward the horizon ──
	vec3 V = normalize(uWaterCam - vPositionW);
	float ndv = clamp(dot(wNormal, V), 0.0, 1.0);
	float F = min(uWaterFres.z, uWaterFres.x + (1.0 - uWaterFres.x) * pow(1.0 - ndv, uWaterFres.y)) * (1.0 - wFoam);
	vec3 R = reflect(-V, wNormal);
	vec3 refl = mix(uWaterSkyLow, uWaterSkyHigh, smoothstep(0.0, 0.6, R.y)) * uWaterFres.w;
	// only water lying on the reflected plane (the sea and the surf) shows it; a pool on another terrace keeps the sky
	float onPlane = 1.0 - smoothstep(0.02, 0.1, abs(vPositionW.y - big.x - uWaterRefl.z));
	if (uWaterRefl.x * onPlane > 0.0) {
		vec4 q = uWaterReflectVP * vec4(vPositionW + vec3(wNormal.x, 0.0, wNormal.z) * uWaterRefl.y, 1.0);
		vec2 uv = clamp(q.xy / q.w * 0.5 + 0.5, vec2(0.001), vec2(0.999));
		refl = mix(refl, texture2D(uWaterReflectTex, uv).rgb, uWaterRefl.x * onPlane);
	}
	float night = uWaterMisc.y;
	// by night the colour turns moonlit navy (keeping a little of the shallows' lift) and dims
	c = mix(c, uWaterNight * (0.7 + 0.6 * dot(c, vec3(0.2126, 0.7152, 0.0722)) / max(dot(uWaterShallow, vec3(0.2126, 0.7152, 0.0722)), 1e-3)), night);
	vec3 albedo = mix(c, uWaterFoam, wFoam) * mix(1.0, uWaterMisc.z, night);
	dAlbedo = albedo * (1.0 - F);
	// the sky's light on the water's own colour (the engine's sky light is off for this material), then the reflection
	vec3 hue = c / max(max(c.r, max(c.g, c.b)), 1e-4);
	refl *= mix(vec3(1.0), hue, uWaterReflTint);
	wEmit = dAlbedo * uWaterSkyHigh * uWaterAmbient + refl * F;
	// ── glints: crisp shapes where the surface turns the sun (or moon) toward the eye. Their edge widens with how fast
	// the reflection changes across a pixel and with the normal's spread within it, and they dim as they widen (the
	// same light over a bigger patch), so far away they become the soft highlight instead of specks ──
	float sl = dot(R, uWaterLightDir);
	float fw = fwidth(sl);
	float widen = fw + 0.35 * sqrt(vary);
	float glint = smoothstep(uWaterGlint.x - uWaterGlint.y - widen, uWaterGlint.x + uWaterGlint.y + widen, sl);
	glint *= (uWaterGlint.y + 0.002) / (uWaterGlint.y + 0.002 + widen) * (1.0 - smoothstep(0.01, 0.03, fw)) * keep;
	// (E28.W05: by night the moon's are boosted, so it lays a path of light across the sea)
	wEmit += uWaterLightCol * glint * uWaterGlint.z * mix(1.0, uWaterGlint.w, uWaterMisc.y) * (1.0 - wFoam) * smoothstep(0.0, 0.1, uWaterLightDir.y);
	// ── E28.W05 (#698): the lamps on the water. Each lit lamp near the view lays its reflection on the ripples: a
	// bright streak where the surface turns the bulb toward the eye (the ripples break it into a broken column of
	// light running toward the camera, as lamps do on real water) and a broad, faint sheen round it. Both widen and dim
	// with the normal's spread, like the glints, and fade with the lamp's distance. ──
	vec3 lampL = vec3(0.0);
	for (int i = 0; i < ${LAMP_MAX}; i++) {
		if (float(i) >= uWaterLampK.x) break;
		vec4 lp = uWaterLamp[i];
		vec3 toL = lp.xyz - vPositionW;
		float d2 = max(dot(toL, toL), 1e-4);
		float ls = dot(R, toL * inversesqrt(d2));
		float wid = uWaterLampK.y + 0.35 * sqrt(vary) + fwidth(ls);
		float streak = exp(-(1.0 - ls) / wid) * uWaterLampK.y / wid;
		float sheen = exp(-(1.0 - ls) / uWaterLampK.z);
		lampL += uWaterLampC[i] * (lp.w / (1.0 + d2 / (uWaterLampK.w * uWaterLampK.w))) * (streak * uWaterLampS.x + sheen * uWaterLampS.y);
	}
	// (a mirror reflects more toward grazing: from about a third looking straight down to all of it)
	wEmit += lampL * (1.0 - wFoam) * mix(0.35, 1.0, F / max(uWaterFres.z, 1e-3));
	// ── E28.W03 (#696): under a deck low over the water (a cover) the water lies in its shade: its colour, the sky it
	// reflects and the sun's glints all darken, from a little in under the deck's edge, fading out just past it ──
	float shadeK = 0.0;
	for (int i = 0; i < ${COVER_MAX}; i++) {
		if (float(i) >= uWaterCoverN) break;
		vec4 cv = uWaterCover[i];
		vec2 o = max(cv.xy - p, p - cv.zw);
		float sd = max(o.x, o.y) > 0.0 ? length(max(o, vec2(0.0))) : max(o.x, o.y);
		shadeK = max(shadeK, 1.0 - smoothstep(-uWaterUnder.y, uWaterUnder.z, sd));
	}
	float lit = 1.0 - uWaterUnder.x * shadeK;
	dAlbedo *= lit;
	wEmit *= lit;
}
`;

const WATER_DIFFUSE_PS = /* glsl */ `
${WATER_COMMON}
void getAlbedo() {
	sbWaterSetup();
}
`;

const WATER_NORMAL_PS = /* glsl */ `
void getNormal() {
	dNormalW = wNormal;
}
`;

const WATER_GLOSS_PS = /* glsl */ `
void getGlossiness() {
	dGlossiness = mix(wGloss, 0.3, wFoam) + 0.0000001;
}
`;

const WATER_EMISSIVE_PS = /* glsl */ `
void getEmission() {
	dEmission = wEmit;
}
`;

const layers = new WeakMap<pc.AppBase, pc.Layer>();
let waterLayerId: number | undefined;

/**
 * The water's own layer (one per app, made on first call), drawn just after the world: the High-tier planar
 * reflection draws the sky and the world, so the water never reflects (or samples) itself.
 */
export function waterLayer(app: pc.AppBase): pc.Layer {
  let layer = layers.get(app);
  if (!layer) {
    const comp = app.scene.layers;
    const world = comp.getLayerById(pc.LAYERID_WORLD)!;
    layer = new pc.Layer({ name: 'Water' });
    comp.insertOpaque(layer, comp.getOpaqueIndex(world) + 1);
    comp.insertTransparent(layer, comp.getTransparentIndex(world) + 1);
    layers.set(app, layer);
  }
  waterLayerId = layer.id;
  return layer;
}

/**
 * The layers a world light shines on: the world and the water (a light only lights its own layers). Every light
 * that lights the world takes this, so the sun, the fill, the lamps and Bloombot's lantern all reach the water.
 */
export function worldLightLayers(): number[] {
  return waterLayerId === undefined ? [pc.LAYERID_WORLD] : [pc.LAYERID_WORLD, waterLayerId];
}

/** Ripple-map texels a side. */
export const RIPPLE_RES = 256;
/** The largest slope a ripple map stores (its encoding's range); the shader scales by LOOK.water.ripples.strength. */
export const RIPPLE_RANGE = 3;

/**
 * A tileable ripple map: `RIPPLE_RES`² texels of slope (dh/dx in red, dh/dz in green, -range … range as 0 … 255) and
 * the squared slope (blue, 0 … 2·range² as 0 … 255), so a mipmapped read gives both the mean slope and its spread.
 * Made of waves whose lengths (in a map of `size` units) run from `min` to `max` units, each a whole number of times
 * across the map (so it tiles), in every direction, scaled so their slope is 1 on average (root mean square).
 * Deterministic by seed.
 */
export function rippleMapData(size: number, min: number, max: number, seed: number): Uint8Array {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // every whole-number wave vector whose wavelength falls in range, half-plane only (each counted once)
  const lo = size / max;
  const hi = size / min;
  const cand: [number, number][] = [];
  for (let fz = 0; fz <= Math.ceil(hi); fz++)
    for (let fx = -Math.ceil(hi); fx <= Math.ceil(hi); fx++) {
      if (fz === 0 && fx <= 0) continue;
      const f = Math.hypot(fx, fz);
      if (f >= lo && f <= hi) cand.push([fx, fz]);
    }
  const waves: { fx: number; fz: number; a: number; ph: number }[] = [];
  const n = Math.min(28, cand.length);
  for (let i = 0; i < n; i++) {
    const j = Math.floor(rnd() * cand.length);
    const [fx, fz] = cand.splice(j, 1)[0];
    waves.push({ fx, fz, a: 0.5 + rnd(), ph: rnd() * Math.PI * 2 });
  }
  const N = RIPPLE_RES;
  const sx = new Float32Array(N * N);
  const sz = new Float32Array(N * N);
  let sum2 = 0;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let ax = 0;
      let az = 0;
      for (const w of waves) {
        // slope of a·sin(2π(fx·u + fz·v) + φ) over a map `size` units wide, in world units
        const c = Math.cos(2 * Math.PI * ((w.fx * x + w.fz * y) / N) + w.ph) * w.a;
        ax += c * w.fx;
        az += c * w.fz;
      }
      sx[y * N + x] = ax;
      sz[y * N + x] = az;
      sum2 += ax * ax + az * az;
    }
  const norm = 1 / Math.sqrt(sum2 / (N * N) / 2);
  const out = new Uint8Array(N * N * 4);
  const R = RIPPLE_RANGE;
  const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  for (let i = 0; i < N * N; i++) {
    const a = Math.min(R, Math.max(-R, sx[i] * norm));
    const b = Math.min(R, Math.max(-R, sz[i] * norm));
    out[i * 4] = byte(a / (2 * R) + 0.5);
    out[i * 4 + 1] = byte(b / (2 * R) + 0.5);
    out[i * 4 + 2] = byte((a * a + b * b) / (2 * R * R));
    out[i * 4 + 3] = 255;
  }
  return out;
}

type RippleMap = { size: number; angle: number; speed: number };

/**
 * How the two ripple maps are read (for the shader and tests): map 1 is turned by the angle between the two maps
 * (its texture frame is the world turned by that, cos / sin), and each map's reading drifts so its pattern travels
 * toward its own angle at its own speed: a pattern moving at v is read at (p - v·t), so the drift is -v / size (map 1
 * in its turned frame).
 */
export function rippleDrift(m0: RippleMap, m1: RippleMap) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const turn = rad(m1.angle - m0.angle);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const v0 = [Math.cos(rad(m0.angle)) * m0.speed, Math.sin(rad(m0.angle)) * m0.speed];
  const v1 = [Math.cos(rad(m1.angle)) * m1.speed, Math.sin(rad(m1.angle)) * m1.speed];
  // turned as the shader's mat2(cos, sin, -sin, cos) turns p
  const t1 = [cos * v1[0] - sin * v1[1], sin * v1[0] + cos * v1[1]];
  return { drift0: [-v0[0] / m0.size, -v0[1] / m0.size], drift1: [-t1[0] / m1.size, -t1[1] / m1.size], cos, sin };
}

function rippleTexture(device: pc.GraphicsDevice, m: { size: number; seed: number }, name: string): pc.Texture {
  const R = LOOK.water.ripples;
  const tex = new pc.Texture(device, {
    name,
    width: RIPPLE_RES,
    height: RIPPLE_RES,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    anisotropy: 8,
  });
  const px = tex.lock();
  px.set(rippleMapData(m.size, R.min, R.max, m.seed));
  tex.unlock();
  return tex;
}

let material: pc.StandardMaterial | undefined;
let reflectTex: pc.Texture | undefined;

/** The shared water material (one per device). */
export function waterMaterial(device?: pc.GraphicsDevice): pc.StandardMaterial {
  if (material) return material;
  const m = new pc.StandardMaterial();
  m.name = 'water';
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseVertexColor = true;
  m.useMetalness = false;
  m.useSkybox = false; // the sky reflection is the shader's own
  m.emissive = new pc.Color(1, 1, 1);
  if (device && !device.isWebGPU) {
    try {
      const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
      chunks.set('diffusePS', WATER_DIFFUSE_PS);
      chunks.set('normalMapPS', WATER_NORMAL_PS);
      chunks.set('glossPS', WATER_GLOSS_PS);
      chunks.set('emissivePS', WATER_EMISSIVE_PS);
      // the large waves lift the surface in the vertex shader (the engine's own transform, with one line added)
      const transform = pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_GLSL).get('transformVS');
      if (transform?.includes(WAVES_ANCHOR))
        chunks.set(
          'transformVS',
          `uniform float uWaterTime;\n${WAVES_GLSL}\n` +
            transform.replace(
              WAVES_ANCHOR,
              `${WAVES_ANCHOR}\n\t#ifdef VERTEX_COLOR\n\t\tposW.y += sbWaves(posW.xz, uWaterTime, vertex_color.r * ${WATER_ENC.toFixed(1)}, 0.0).x;\n\t#endif`,
            ),
        );
      // a 1×1 placeholder until (and unless) the planar reflection runs
      reflectTex = new pc.Texture(device, { width: 1, height: 1, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, name: 'water-reflect-none' });
      // a white 1×1 AO map (no effect) only so the shader gets uv0, which carries a restore's fade window
      const white = new pc.Texture(device, { width: 1, height: 1, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, name: 'water-uv0' });
      const px = white.lock();
      px.set([255, 255, 255, 255]);
      white.unlock();
      m.aoMap = white;
      m.setParameter('uWaterReflectTex', reflectTex);
      const maps = LOOK.water.ripples.maps;
      m.setParameter('uWaterRip0', rippleTexture(device, maps[0], 'water-ripples-0'));
      m.setParameter('uWaterRip1', rippleTexture(device, maps[1], 'water-ripples-1'));
    } catch {
      /* an engine without per-material chunks: plain lit water */
    }
  }
  material = m;
  applyWaterLook();
  setWaterFrame({ time: 0, cam: { x: 0, y: 10, z: 0 }, night: 0, skyLow: [0.8, 0.85, 0.9], skyHigh: [0.6, 0.75, 0.9] });
  m.update();
  return m;
}

const v3 = (hex: string) => lin3(hex);

/** LOOK.water into the material (call again after tuning LOOK.water live). */
export function applyWaterLook() {
  const m = material;
  if (!m) return;
  const W = LOOK.water;
  m.setParameter('uWaterShallow', v3(W.shallow));
  m.setParameter('uWaterDeep', v3(W.deep));
  m.setParameter('uWaterMurky', v3(W.murky));
  m.setParameter('uWaterBed', v3(W.bed));
  m.setParameter('uWaterFoam', v3(W.foam));
  m.setParameter('uWaterNight', v3(W.night));
  m.setParameter('uWaterAmbient', W.ambient);
  m.setParameter('uWaterReflTint', W.reflectTint);
  m.setParameter('uWaterUnder', [LOOK.bridge.under.shade, LOOK.bridge.under.inner, LOOK.bridge.under.soft]);
  m.setParameter('uWaterDepth', [0, W.deepAt, W.bedReach, W.bedShow]);
  m.setParameter('uWaterLap', [W.lap.reach, W.lap.length, W.lap.speed, W.lap.strength]);
  m.setParameter('uWaterFoamL', [W.foamLine.reach, W.foamLine.lines, W.foamLine.speed, W.foamLine.strength]);
  m.setParameter('uWaterShore', 1 - LOOK.shore.waterPull);
  m.setParameter('uWaterFres', [W.fresnel.base, W.fresnel.power, W.fresnel.max, W.sky]);
  // the large waves
  const ws = W.waves.list.slice(0, 4).map(waveParams);
  while (ws.length < 4) ws.push({ dx: 1, dz: 0, k: 1, amp: 0, omega: 0, phase: 0 });
  ws.forEach((w, i) => m.setParameter(`uWaterWave${i}`, [w.dx, w.dz, w.k, w.amp]));
  m.setParameter('uWaterWaveW', ws.map((w) => w.omega));
  m.setParameter('uWaterWaveP', ws.map((w) => w.phase));
  m.setParameter('uWaterWaveE', [W.waves.shore, 1 / W.antiAlias.fadeFrom, 1 / W.antiAlias.fadeTo, W.waves.coverEase]);
  // the ripple maps: map 0 read straight, map 1 read turned (by the angle between the two, so their patterns never
  // line up), each at 1 / size of a map a unit, its pattern travelling toward its own angle at its speed
  const R = W.ripples;
  const [m0, m1] = R.maps;
  const { drift0, drift1, cos, sin } = rippleDrift(m0, m1);
  m.setParameter('uWaterRipA', [1 / m0.size, drift0[0], drift0[1], 0]);
  m.setParameter('uWaterRipB', [1 / m1.size, drift1[0], drift1[1], cos]);
  m.setParameter('uWaterRipC', [R.strength, R.distort, sin, RIPPLE_RANGE]);
  const D = W.disturb;
  m.setParameter('uWaterObsW', [D.width, D.strength]);
  m.setParameter('uWaterGlint', [W.glint.cut, W.glint.soft, W.glint.strength, W.glint.moon]);
  m.setParameter('uWaterAA', [W.antiAlias.variance, 1 / W.antiAlias.rippleFrom, 1 / W.antiAlias.rippleTo, (R.min + R.max) / 2]);
  m.specular = new pc.Color(W.specular, W.specular, W.specular);
  obsAt = undefined;
  m.update();
}

export interface WaterFrame {
  /** seconds (held still for reduced motion) */
  time: number;
  /** the camera's position */
  cam: { x: number; y: number; z: number };
  /** where the camera looks (the disturbers nearest it are drawn); the camera's own spot when not given */
  focus?: { x: number; z: number };
  /** 0 day … 1 deep night */
  night: number;
  /** the sky near the horizon and higher up, 0–1 sRGB (Sky.reflectColours) */
  skyLow: readonly [number, number, number];
  skyHigh: readonly [number, number, number];
  /** the transition clock (TransitionRenderer.time), for restores' clarity fades */
  trTime?: number;
  /** the sun (or moon): toward it, its colour (0–1) and its strength as a share of the noon sun */
  light?: { toLight: { x: number; y: number; z: number }; color: { r: number; g: number; b: number }; share: number };
  /** E28.W05 (#698): the lamps shining now (LightVisuals.shining): the nearest LAMP_MAX to the focus are reflected */
  lamps?: readonly WaterLampIn[];
  /** the planar reflection this frame (High), or none */
  reflect?: { tex: pc.Texture; viewProj: pc.Mat4; planeY: number };
}

/** A lamp as the water takes it: where its bulb is, its colour (sRGB hex) and how strongly it glows (0 … 1). */
export interface WaterLampIn {
  x: number;
  y: number;
  z: number;
  tone: string;
  power: number;
}

/**
 * The lamps the water reflects (for the shader and tests): those glowing at all, nearest the focus first (across the
 * ground), at most `LAMP_MAX` and `LOOK.water.lamps.max`.
 */
export function pickWaterLamps(lamps: readonly WaterLampIn[], fx: number, fz: number): WaterLampIn[] {
  const n = Math.min(LAMP_MAX, LOOK.water.lamps.max);
  return lamps
    .filter((l) => l.power > 0.01)
    .map((l) => ({ l, d: (l.x - fx) ** 2 + (l.z - fz) ** 2 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, n)
    .map((o) => o.l);
}

const lampPos = new Float32Array(LAMP_MAX * 4);
const lampCol = new Float32Array(LAMP_MAX * 3);
const toneLin = new Map<string, [number, number, number]>();
const cam3 = new Float32Array(3);
const light3 = new Float32Array(3);
const lcol3 = new Float32Array(3);
const low3 = new Float32Array(3);
const high3 = new Float32Array(3);
const obs = new Float32Array(DISTURB_MAX * 4);
const cov = new Float32Array(COVER_MAX * 4);
let covN = 0;
let obsAt: { x: number; z: number; v: number; n: number } | undefined;
const lin = (c: number) => Math.pow(Math.max(0, c), 2.2);

/** Per frame: time, camera, night, the sky's colours, the things in the water and the planar reflection (when on). */
export function setWaterFrame(f: WaterFrame) {
  const m = material;
  if (!m) return;
  const W = LOOK.water;
  m.setParameter('uWaterTime', f.time);
  m.setParameter('uWaterTrTime', f.trTime ?? 0);
  const L = f.light;
  light3[0] = L?.toLight.x ?? 0;
  light3[1] = L?.toLight.y ?? 1;
  light3[2] = L?.toLight.z ?? 0;
  m.setParameter('uWaterLightDir', light3);
  const k = Math.max(0, L?.share ?? 0);
  lcol3[0] = lin(L?.color.r ?? 1) * k;
  lcol3[1] = lin(L?.color.g ?? 1) * k;
  lcol3[2] = lin(L?.color.b ?? 1) * k;
  m.setParameter('uWaterLightCol', lcol3);
  cam3[0] = f.cam.x;
  cam3[1] = f.cam.y;
  cam3[2] = f.cam.z;
  m.setParameter('uWaterCam', cam3);
  for (let i = 0; i < 3; i++) {
    low3[i] = lin(f.skyLow[i]);
    high3[i] = lin(f.skyHigh[i]);
  }
  m.setParameter('uWaterSkyLow', low3);
  m.setParameter('uWaterSkyHigh', high3);
  const night = Math.min(1, Math.max(0, f.night));
  m.setParameter('uWaterMisc', [W.caustics * (1 - night), night, W.nightAlbedo, W.gloss]);
  // the disturbers nearest where the camera looks (picked again once it has moved a tile, or the list changed)
  const fx = f.focus?.x ?? f.cam.x;
  const fz = f.focus?.z ?? f.cam.z;
  const v = waterDisturberVersion();
  if (!obsAt || obsAt.v !== v || Math.abs(obsAt.x - fx) + Math.abs(obsAt.z - fz) > 1) {
    obs.fill(0);
    obsAt = { x: fx, z: fz, v, n: nearestWaterDisturbers(fx, fz, Math.min(DISTURB_MAX, W.disturb.max), obs) };
    m.setParameter('uWaterObs[0]', obs);
    cov.fill(0);
    covN = nearestWaterCovers(fx, fz, COVER_MAX, cov);
    m.setParameter('uWaterCover[0]', cov);
  }
  m.setParameter('uWaterCoverN', covN);
  // the lamps
  const lamps = pickWaterLamps(f.lamps ?? [], fx, fz);
  for (let i = 0; i < lamps.length; i++) {
    const l = lamps[i];
    lampPos.set([l.x, l.y, l.z, Math.min(1, l.power)], i * 4);
    let c = toneLin.get(l.tone);
    if (!c) toneLin.set(l.tone, (c = lin3(l.tone)));
    lampCol.set(c, i * 3);
  }
  const LL = W.lamps;
  m.setParameter('uWaterLamp[0]', lampPos);
  m.setParameter('uWaterLampC[0]', lampCol);
  m.setParameter('uWaterLampK', [lamps.length, LL.streak, LL.sheen, LL.reach]);
  m.setParameter('uWaterLampS', [LL.strength, LL.sheenStrength]);
  const D = W.disturb;
  m.setParameter('uWaterObsK', [obsAt.n, D.rate, D.reach, D.length]);
  if (f.reflect) {
    m.setParameter('uWaterReflectTex', f.reflect.tex);
    m.setParameter('uWaterReflectVP', f.reflect.viewProj.data);
    m.setParameter('uWaterRefl', [W.reflect.strength, W.reflect.distort, f.reflect.planeY, 0]);
  } else {
    if (reflectTex) m.setParameter('uWaterReflectTex', reflectTex);
    m.setParameter('uWaterReflectVP', pc.Mat4.IDENTITY.data);
    m.setParameter('uWaterRefl', [0, 0, 0, 0]);
  }
}

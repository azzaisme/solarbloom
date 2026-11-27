import * as pc from 'playcanvas';
import { CLOUDS } from '../data/sky';

/**
 * #painted-clouds: Solarbloom's clouds, painted by a shader instead of built from puffs. One cloud field (soft
 * value-noise, domain-warped so the edges go wispy, stretched along the wind into broad horizontal formations,
 * with a large-scale mask that leaves open blue sky between them) is drawn in two places:
 *
 * - on the sky (`skyCloudMaterial`): a dome round the camera, the field projected onto a ceiling far overhead, so
 *   the formations are enormous and distant, foreshorten toward the horizon and fade into its haze;
 * - over the zoomed-out view (`layerCloudMaterial`): a thin sheet of the same clouds high above the ground,
 *   anchored to the world, and its soft shadow laid on the ground (`shadowCloudMaterial`).
 *
 * Shading is gentle and painterly: each point is lit by how the cloud thins toward the sun (ivory where it faces
 * it, blue-grey in its body), glows silver near the sun, and at sunset is lit from below (gold toward the sun, rose
 * round the sky, a dusky top on thick cores). The colours and the sun come from Sky every frame as global uniforms
 * (`setCloudFrame`), so the day/night cycle, the weather and the sunset all carry through.
 */

/** The shared noise and cloud field (GLSL). */
const FIELD = /* glsl */ `
uniform vec4 uCloudShape;   // cover, softness, scale, stretch
uniform vec4 uCloudDrift;   // drift x, drift z, wisps, ceiling flatness (how little the far clouds crowd together)
uniform vec4 uCloudSun;     // toward the sun (unit), forward glow
uniform vec4 uCloudMix;     // underlight, horizon fade, horizon haze reach, opacity
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uCloudGlow;
uniform vec3 uCloudGlowFar;
uniform vec3 uCloudTop;
uniform vec3 uCloudHorizon;

float sbcHash(vec2 p) {
	p = fract(p * vec2(0.1031, 0.1030));
	p += dot(p, p.yx + 33.33);
	return fract((p.x + p.y) * p.x);
}
float sbcNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(sbcHash(i), sbcHash(i + vec2(1.0, 0.0)), f.x), mix(sbcHash(i + vec2(0.0, 1.0)), sbcHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float sbcFbm(vec2 p) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 5; i++) {
		s += a * sbcNoise(p);
		p = mat2(1.62, 1.18, -1.18, 1.62) * p + 17.3;
		a *= 0.5;
	}
	return s;
}

// how much cloud there is at a point on the cloud ceiling (0 open sky … 1 thick)
float sbcDensity(vec2 q) {
	vec2 p = (q + uCloudDrift.xy) * uCloudShape.z;
	p.x /= uCloudShape.w; // drawn out along the wind: broad, horizontal formations
	// formations: big soft patches with open sky between them
	float big = sbcFbm(p * 0.28 + vec2(5.2, 1.3));
	// the body, warped so its edges curl and tear into wisps
	vec2 w = vec2(sbcFbm(p * 0.7 + vec2(1.7, 9.2)), sbcFbm(p * 0.7 + vec2(8.3, 2.8)));
	float body = sbcFbm(p + (w - 0.5) * 1.6);
	float d = body * 0.62 + big * 0.62 - 0.12;
	// fine wisps: torn away from the edges only
	float fine = sbcFbm(p * 3.3 + w * 2.0);
	float edge = 1.0 - abs(d - uCloudShape.x) / max(uCloudShape.y * 2.0, 1e-3);
	d -= (fine - 0.5) * uCloudDrift.z * clamp(edge, 0.0, 1.0);
	return clamp((d - uCloudShape.x) / max(uCloudShape.y, 1e-3), 0.0, 1.0);
}

// the colour and coverage of the cloud at q, seen along dir (unit, from the eye); toSunQ: the sun's way across the ceiling
vec4 sbcShade(vec2 q, vec3 dir, vec2 toSunQ) {
	float d = sbcDensity(q);
	if (d <= 0.001) return vec4(0.0);
	// lit where the cloud thins toward the sun, in shadow where it thickens
	float ahead = sbcDensity(q + toSunQ);
	float light = clamp(0.62 + (d - ahead) * 1.6, 0.0, 1.0);
	vec3 col = mix(uCloudShade, uCloudLit, light);
	// the thick heart of a formation a little deeper, so it reads as a volume, not a sticker
	col = mix(col, uCloudShade, smoothstep(0.55, 1.0, d) * 0.3);
	// a silver glow round the sun through the thin parts
	float toward = max(dot(dir, uCloudSun.xyz), 0.0);
	col += uCloudLit * pow(toward, 10.0) * (1.0 - d) * uCloudSun.w;
	// sunset: lit from below, gold toward the sun and rose round the sky; thick cores and their tops stay dusky
	if (uCloudMix.x > 0.001) {
		vec2 hd = normalize(dir.xz + vec2(1e-5));
		vec2 hs = normalize(uCloudSun.xz + vec2(1e-5));
		float f = smoothstep(-0.3, 1.0, dot(hd, hs));
		vec3 glow = mix(uCloudGlowFar, uCloudGlow, f * f);
		vec3 under = mix(glow, uCloudTop, clamp(d * 0.75 + (1.0 - light) * 0.35, 0.0, 1.0));
		col = mix(col, under, uCloudMix.x);
	}
	// never let a stray value reach the bloom
	col = clamp(col, 0.0, 2.0);
	float a = clamp(d * uCloudMix.w, 0.0, 1.0);
	if (!(a >= 0.0) || any(isnan(col))) return vec4(0.0);
	return vec4(col, a);
}
`;

/** The sky's cloud dome: the field on a ceiling far overhead, seen through the dome's directions. */
const SKY_PS = /* glsl */ `
${FIELD}
uniform vec3 uCloudEye;
vec4 sbcSky;
bool sbcSkyDone = false;
void sbcSkyCompute() {
	if (sbcSkyDone) return;
	sbcSkyDone = true;
	vec3 dir = normalize(vPositionW - uCloudEye);
	if (dir.y <= 0.0) { sbcSky = vec4(0.0); return; }
	// onto the ceiling: a flat layer far overhead, so the formations shrink and crowd toward the horizon
	float k = 1.0 / (dir.y + uCloudDrift.w);
	vec2 q = dir.xz * k;
	vec2 sunQ = normalize(uCloudSun.xz + vec2(1e-5)) * 0.18;
	vec4 c = sbcShade(q, dir, sunQ);
	// atmospheric depth: far clouds take on the horizon's colour and thin away into it
	c.rgb = mix(uCloudHorizon, c.rgb, smoothstep(0.0, uCloudMix.z, dir.y));
	c.a *= smoothstep(0.0, uCloudMix.y, dir.y);
	sbcSky = c;
}
void getOpacity() {
	sbcSkyCompute();
	dAlpha = sbcSky.a;
}
`;
const SKY_EMIT_PS = /* glsl */ `
void getEmission() {
	sbcSkyCompute();
	dEmission = sbcSky.rgb;
}
`;

/** The zoomed-out view's cloud sheet: the field anchored to the world, seen from above. */
const LAYER_PS = /* glsl */ `
${FIELD}
uniform vec3 uCloudEye;
uniform vec4 uCloudLayer;   // world scale, opacity, (unused), (unused)
vec4 sbcLay;
bool sbcLayDone = false;
void sbcLayCompute() {
	if (sbcLayDone) return;
	sbcLayDone = true;
	vec3 dir = normalize(vPositionW - uCloudEye);
	vec2 q = vPositionW.xz * uCloudLayer.x;
	vec2 sunQ = normalize(uCloudSun.xz + vec2(1e-5)) * 0.18;
	// seen from above, the sun lights the side facing it: the view direction counts as level here
	vec4 c = sbcShade(q, normalize(vec3(dir.x, 0.15, dir.z)), sunQ);
	c.a *= uCloudLayer.y;
	sbcLay = c;
}
void getOpacity() {
	sbcLayCompute();
	dAlpha = sbcLay.a;
}
`;
const LAYER_EMIT_PS = /* glsl */ `
void getEmission() {
	sbcLayCompute();
	dEmission = sbcLay.rgb;
}
`;

/** The sheet's soft shadow on the ground: the field where the sun's ray through each ground point meets the sheet. */
const SHADOW_PS = /* glsl */ `
${FIELD}
uniform vec4 uCloudLayer;   // world scale, opacity, sheet height above the ground, shadow strength
void getOpacity() {
	vec3 s = uCloudSun.xyz;
	vec2 at = vPositionW.xz + s.xz / max(s.y, 0.2) * uCloudLayer.z;
	dAlpha = sbcDensity(at * uCloudLayer.x) * uCloudLayer.w;
}
`;

function makeMaterial(device: pc.GraphicsDevice, opacityPS: string, emitPS: string | undefined, name: string): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.name = name;
  m.useLighting = false;
  m.useFog = false;
  m.useSkybox = false;
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color(1, 1, 1);
  m.depthWrite = false;
  m.cull = pc.CULLFACE_NONE;
  m.blendType = pc.BLEND_NORMAL;
  m.opacity = 1;
  if (!device.isWebGPU) {
    try {
      const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
      chunks.set('opacityPS', opacityPS);
      if (emitPS) chunks.set('emissivePS', emitPS);
    } catch {
      m.opacity = 0; // an engine without per-material chunks: no clouds rather than broken ones
    }
  } else m.opacity = 0;
  m.update();
  return m;
}

export const skyCloudMaterial = (device: pc.GraphicsDevice) => makeMaterial(device, SKY_PS, SKY_EMIT_PS, 'clouds-sky');
export const layerCloudMaterial = (device: pc.GraphicsDevice) => makeMaterial(device, LAYER_PS, LAYER_EMIT_PS, 'clouds-layer');
export function shadowCloudMaterial(device: pc.GraphicsDevice, colour: pc.Color): pc.StandardMaterial {
  const m = makeMaterial(device, SHADOW_PS, undefined, 'clouds-shadow');
  m.emissive = colour;
  m.update();
  return m;
}

/** What the clouds look like this frame (Sky fills it). Colours are as the sky's own are given (see Sky). */
export interface CloudFrame {
  lit: [number, number, number];
  shade: [number, number, number];
  glow: [number, number, number];
  glowFar: [number, number, number];
  top: [number, number, number];
  horizon: [number, number, number];
  /** toward the sun (unit) */
  sun: pc.Vec3;
  /** 0 … 1: the sunset's light from below */
  under: number;
  /** 0 clear … 1 heavy cloud */
  overcast: number;
  /** how far the clouds have drifted (ceiling units) */
  drift: [number, number];
  /** the camera's position */
  eye: pc.Vec3;
}

// one array per uniform: the engine keeps a reference to the value it is given, not a copy
const arrays = new Map<string, Float32Array>();
function arr(name: string, n: number): Float32Array {
  let a = arrays.get(name);
  if (!a) arrays.set(name, (a = new Float32Array(n)));
  return a;
}
function set3(device: pc.GraphicsDevice, name: string, c: ArrayLike<number>) {
  const a = arr(name, 3);
  a[0] = c[0];
  a[1] = c[1];
  a[2] = c[2];
  device.scope.resolve(name).setValue(a);
}
function set4(device: pc.GraphicsDevice, name: string, x: number, y: number, z: number, w: number) {
  const a = arr(name, 4);
  a[0] = x;
  a[1] = y;
  a[2] = z;
  a[3] = w;
  device.scope.resolve(name).setValue(a);
}

/** How much of the sky is cloud: the fair-weather cover, thickening toward full cover under heavy cloud. */
export function cloudCover(overcast: number): number {
  return CLOUDS.cover - overcast * CLOUDS.overcastCover;
}

/** Hands this frame's clouds to every cloud shader (they read global uniforms). */
export function setCloudFrame(device: pc.GraphicsDevice, f: CloudFrame) {
  const C = CLOUDS;
  set4(device, 'uCloudShape', cloudCover(f.overcast), C.softness, C.scale, C.stretch);
  set4(device, 'uCloudDrift', f.drift[0], f.drift[1], C.wisps, C.flatness);
  set4(device, 'uCloudSun', f.sun.x, f.sun.y, f.sun.z, C.sunGlow * (1 - f.overcast));
  set4(device, 'uCloudMix', f.under, C.horizonFade, C.horizonHaze, Math.min(1, C.opacity + f.overcast * 0.1));
  set3(device, 'uCloudLit', f.lit);
  set3(device, 'uCloudShade', f.shade);
  set3(device, 'uCloudGlow', f.glow);
  set3(device, 'uCloudGlowFar', f.glowFar);
  set3(device, 'uCloudTop', f.top);
  set3(device, 'uCloudHorizon', f.horizon);
  set3(device, 'uCloudEye', [f.eye.x, f.eye.y, f.eye.z]);
}

/** The zoomed-out sheet's own values: its world scale, how solid it is (`show` fades it in), its height over the
 * ground (for its shadow) and its shadow's strength. */
export function setCloudLayer(device: pc.GraphicsDevice, show: number, height: number) {
  const L = CLOUDS.layer;
  set4(device, 'uCloudLayer', L.scale, L.opacity * show, height, L.shadow * show);
}

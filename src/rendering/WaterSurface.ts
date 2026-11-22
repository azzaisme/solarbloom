import * as pc from 'playcanvas';
import { LOOK } from '../data/look';

/**
 * E28.W01 (#694): the water. One surface and one material for every stretch of live water: the open sea and its
 * shallows, the beach's surf (murky while dead, clear once restored) and restored pools and ponds. It replaces the
 * flat per-tile slabs (which stay underneath as the sea bed and the restoration state) and the old pool shader.
 *
 * Each vertex carries how far it lies from land (red, 0 … WATER_ENC tiles) and how clear the water is (green, 0 murky
 * … 1 clear). From those the shader draws:
 * - colour by depth: turquoise by the shore through to deep blue-teal far out, with the sand bed and light nets
 *   showing through the shallows, and murky green-grey for dead surf;
 * - ripples: a handful of drifting waves plus waves that follow the shore and the outline of anything standing in
 *   the water (rocks, the jetty, islands), travelling in toward it, and foam lines that lap the same outlines;
 * - lighting: the engine's own sun (or moon) and lights on those rippled normals, with a sharp, soft-capped
 *   highlight and no environment cube (the sky reflection below replaces it);
 * - reflection by Fresnel: little looking straight down, much more toward the horizon. The sky's colours on every
 *   tier, and on High a planar reflection of the world (WaterReflection) broken up by the ripples.
 * Everything is a named value in LOOK.water. WebGL2 only (as the rest of the look); WebGPU keeps plain lit water.
 */

/** Distance to land (tiles) encoded in a vertex's red channel: 0 … WATER_ENC */
export const WATER_ENC = 8;

/** How clear a live water tile is: dead surf is murky; the sea, restored water and ponds are clear. */
export const WATER_CLARITY = { murky: 0.3, clear: 1 } as const;

/** A water vertex's colour bytes: distance to land and clarity. */
export function encodeWater(dist: number, clarity: number): [number, number, number, number] {
  const r = Math.round((Math.min(WATER_ENC, Math.max(0, dist)) / WATER_ENC) * 255);
  const g = Math.round(Math.min(1, Math.max(0, clarity)) * 255);
  return [r, g, 0, 255];
}

/** The water's colour by depth (linear), as the shader mixes it before bed, foam and light (tests and tuning). */
export function waterColourAt(dist: number): [number, number, number] {
  const W = LOOK.water;
  const ss = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const s = lin3(W.shallow);
  const m = lin3(W.mid);
  const d = lin3(W.deep);
  const a = ss(0, W.midAt, dist);
  const b = ss(W.midAt, W.deepAt, dist);
  return [0, 1, 2].map((i) => {
    const c = s[i] + (m[i] - s[i]) * a;
    return c + (d[i] - c) * b;
  }) as [number, number, number];
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

const WATER_COMMON = /* glsl */ `
uniform float uWaterTime;
uniform vec3 uWaterCam;
uniform vec3 uWaterShallow;
uniform vec3 uWaterMid;
uniform vec3 uWaterDeep;
uniform vec3 uWaterMurky;
uniform vec3 uWaterBed;
uniform vec3 uWaterFoam;
uniform vec3 uWaterNight;
uniform vec4 uWaterDepth;  // midAt, deepAt, bedReach, bedShow
uniform vec4 uWaterRipple; // scale, speed, strength, fine
uniform vec4 uWaterLap;    // reach, length, speed, strength
uniform vec4 uWaterFoamL;  // reach, lines, speed, strength
uniform vec4 uWaterFres;   // base, power, max, sky
uniform float uWaterAmbient;
uniform float uWaterReflTint;
uniform vec4 uWaterRefl;   // strength (0 = off), distort, the reflected plane's height
uniform vec4 uWaterMisc;   // caustics, night, nightAlbedo, gloss
uniform vec3 uWaterSkyLow;
uniform vec3 uWaterSkyHigh;
uniform sampler2D uWaterReflectTex;
uniform mat4 uWaterReflectVP;
vec3 wNormal;
vec3 wEmit;
float wFoam;
float sbWaterHash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float sbWaterNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(sbWaterHash(i), sbWaterHash(i + vec2(1.0, 0.0)), u.x), mix(sbWaterHash(i + vec2(0.0, 1.0)), sbWaterHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// one drifting wave's slope (d height / d xz), faded out where it would be finer than a few pixels
vec2 sbWave(vec2 p, vec2 dir, float len, float speed, float amp, float t, float px) {
	float k = 6.2831853 / len;
	float fade = 1.0 - smoothstep(0.15, 0.45, px * k / 6.2831853);
	return dir * (k * amp * cos(dot(dir, p) * k + t * speed * k) * fade);
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
	float dist = 0.0;
	float clarity = 1.0;
	#ifdef STD_DIFFUSE_VERTEX
		dist = vVertexColor.r * ${WATER_ENC.toFixed(1)};
		clarity = vVertexColor.g;
	#endif
	float px = length(fwidth(p));
	// ── ripples: drifting waves in a few directions, the finer ones fading with distance. Their field is bent by
	// slow noise so crossing waves never settle into a regular checker ──
	float sc = uWaterRipple.x;
	float sp = uWaterRipple.y;
	vec2 pw = p + 0.45 * sc * vec2(sbWaterNoise(p * 0.45 + vec2(t * 0.03, 0.0)) - 0.5, sbWaterNoise(p * 0.45 + vec2(7.3, -t * 0.025)) - 0.5);
	vec2 g = vec2(0.0);
	g += sbWave(pw, normalize(vec2(1.0, 0.35)), 1.00 * sc, 0.9 * sp, 0.060, t, px);
	g += sbWave(pw, normalize(vec2(-0.45, 1.0)), 0.71 * sc, 0.8 * sp, 0.040, t, px);
	g += sbWave(pw, normalize(vec2(0.8, -0.6)), 0.47 * sc, 1.1 * sp, 0.026, t, px);
	g += sbWave(pw, normalize(vec2(-1.0, -0.2)), 0.31 * sc, 1.3 * sp, 0.016, t, px) * (0.5 + uWaterRipple.w);
	g += sbWave(pw, normalize(vec2(0.25, 1.0)), 0.19 * sc, 1.6 * sp, 0.010, t, px) * uWaterRipple.w * 1.6;
	g += sbWave(pw, normalize(vec2(0.95, 0.3)), 0.12 * sc, 1.9 * sp, 0.006, t, px) * uWaterRipple.w * 1.6;
	// ── waves that follow the shore and the outline of anything in the water, travelling in toward it ──
	vec2 dd = vec2(dFdx(dist), dFdy(dist));
	vec2 jx = dFdx(p);
	vec2 jy = dFdy(p);
	float det = jx.x * jy.y - jx.y * jy.x;
	vec2 gd = abs(det) > 1e-8 ? vec2(dd.x * jy.y - dd.y * jx.y, dd.y * jx.x - dd.x * jy.x) / det : vec2(0.0);
	float lapK = 6.2831853 / max(uWaterLap.y, 0.05);
	float near = 1.0 - smoothstep(0.0, uWaterLap.x, dist);
	float lapFade = 1.0 - smoothstep(0.15, 0.45, px * lapK / 6.2831853);
	g += gd * (cos(dist * lapK + t * uWaterLap.z * lapK) * lapK * 0.02 * uWaterLap.w * near * lapFade);
	// murky water lies flatter
	g *= uWaterRipple.z * mix(0.6, 1.0, clarity) * 7.0;
	wNormal = normalize(vec3(-g.x, 1.0, -g.y));
	// ── colour by depth: turquoise by the shore, deep blue-teal far out ──
	vec3 c = mix(uWaterShallow, uWaterMid, smoothstep(0.0, uWaterDepth.x, dist));
	c = mix(c, uWaterDeep, smoothstep(uWaterDepth.x, uWaterDepth.y, dist));
	// the sand bed, and light nets on it, through the clear shallows (shifted by the ripples)
	float bedK = (1.0 - smoothstep(0.0, uWaterDepth.z, dist)) * uWaterDepth.w * clarity;
	// two layers at different scales and angles, so the nets never line up into a grid
	vec2 pc1 = p * 2.6 + wNormal.xz * 0.6;
	vec2 pc2 = mat2(0.8, -0.6, 0.6, 0.8) * p * 1.9 + vec2(3.7, 1.9) + wNormal.xz * 0.6;
	float caus = uWaterMisc.x > 0.0 ? 0.6 * (sbWaterCaustic(pc1, t) + sbWaterCaustic(pc2, t * 0.83)) * uWaterMisc.x : 0.0;
	c = mix(c, uWaterBed * (1.0 + caus * 1.5), bedK);
	c = mix(uWaterMurky, c, clarity);
	// ── foam: an edge on the shore and lines lapping in, broken up so it never rings in perfect contours ──
	float fr = max(uWaterFoamL.x, 0.05);
	float n1 = sbWaterNoise(p * 2.3 + vec2(t * 0.11, -t * 0.07));
	float n2 = sbWaterNoise(p * 5.1 - vec2(t * 0.05, t * 0.09));
	float edge = 1.0 - smoothstep(0.02, 0.09 + 0.05 * n1, dist);
	float band = fract(dist / fr * uWaterFoamL.y + t * uWaterFoamL.z + n1 * 0.35);
	float lines = smoothstep(0.72, 0.9, band) * (1.0 - smoothstep(0.9, 1.0, band)) * (1.0 - smoothstep(0.0, fr * 2.0, dist));
	wFoam = clamp((edge + lines * 0.7) * smoothstep(0.25, 0.65, n2 + 0.25 * edge) * uWaterFoamL.w, 0.0, 1.0) * mix(0.5, 1.0, clarity);
	// ── Fresnel: the sky (and, on High, the world) reflected, more toward the horizon ──
	vec3 V = normalize(uWaterCam - vPositionW);
	float ndv = clamp(dot(wNormal, V), 0.0, 1.0);
	float F = min(uWaterFres.z, uWaterFres.x + (1.0 - uWaterFres.x) * pow(1.0 - ndv, uWaterFres.y)) * (1.0 - wFoam);
	vec3 R = reflect(-V, wNormal);
	vec3 refl = mix(uWaterSkyLow, uWaterSkyHigh, smoothstep(0.0, 0.6, R.y)) * uWaterFres.w;
	// only water lying on the reflected plane (the sea and the surf) shows it; a pool on another terrace keeps the sky
	float onPlane = 1.0 - smoothstep(0.02, 0.1, abs(vPositionW.y - uWaterRefl.z));
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
	dGlossiness = mix(uWaterMisc.w, 0.3, wFoam) + 0.0000001;
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
      // a 1×1 placeholder until (and unless) the planar reflection runs
      reflectTex = new pc.Texture(device, { width: 1, height: 1, format: pc.PIXELFORMAT_RGBA8, mipmaps: false, name: 'water-reflect-none' });
      m.setParameter('uWaterReflectTex', reflectTex);
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
  m.setParameter('uWaterMid', v3(W.mid));
  m.setParameter('uWaterDeep', v3(W.deep));
  m.setParameter('uWaterMurky', v3(W.murky));
  m.setParameter('uWaterBed', v3(W.bed));
  m.setParameter('uWaterFoam', v3(W.foam));
  m.setParameter('uWaterNight', v3(W.night));
  m.setParameter('uWaterAmbient', W.ambient);
  m.setParameter('uWaterReflTint', W.reflectTint);
  m.setParameter('uWaterDepth', [W.midAt, W.deepAt, W.bedReach, W.bedShow]);
  m.setParameter('uWaterRipple', [W.ripple.scale, W.ripple.speed, W.ripple.strength, W.ripple.fine]);
  m.setParameter('uWaterLap', [W.lap.reach, W.lap.length, W.lap.speed, W.lap.strength]);
  m.setParameter('uWaterFoamL', [W.foamLine.reach, W.foamLine.lines, W.foamLine.speed, W.foamLine.strength]);
  m.setParameter('uWaterFres', [W.fresnel.base, W.fresnel.power, W.fresnel.max, W.sky]);
  m.specular = new pc.Color(W.specular, W.specular, W.specular);
  m.update();
}

export interface WaterFrame {
  /** seconds (held still for reduced motion) */
  time: number;
  /** the camera's position */
  cam: { x: number; y: number; z: number };
  /** 0 day … 1 deep night */
  night: number;
  /** the sky near the horizon and higher up, 0–1 sRGB (Sky.reflectColours) */
  skyLow: readonly [number, number, number];
  skyHigh: readonly [number, number, number];
  /** the planar reflection this frame (High), or none */
  reflect?: { tex: pc.Texture; viewProj: pc.Mat4; planeY: number };
}

const cam3 = new Float32Array(3);
const low3 = new Float32Array(3);
const high3 = new Float32Array(3);
const lin = (c: number) => Math.pow(Math.max(0, c), 2.2);

/** Per frame: time, camera, night, the sky's colours and the planar reflection (when on). */
export function setWaterFrame(f: WaterFrame) {
  const m = material;
  if (!m) return;
  const W = LOOK.water;
  m.setParameter('uWaterTime', f.time);
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

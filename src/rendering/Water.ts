import * as pc from 'playcanvas';
import type { GfxTier } from '../data/look';
import { PALETTE } from './Materials';

/**
 * Pools: water lies `drop` below the ground, in a basin whose banks take the neighbouring tile's material. Where a
 * pool turns an outer corner the bank is rounded: `fillet` is the radius in a narrow pool, `wide` where the pool
 * carries on behind the corner tile on both sides. `arc` = segments per rounded corner. Clean water gets a surface
 * mesh of `grid`×`grid` cells a tile, coloured by how far it is from the bank (deep at `deepAt` tiles).
 */
export const WATER = { drop: 0.13, fillet: 0.42, wide: 0.78, arc: 7, grid: 4, deepAt: 1.15 };

/**
 * The clean-water look: the vertex colour carries the shallow-to-deep gradient and its alpha the depth (0 at the
 * bank … 1 deep). On top of that the shader draws a drifting net of light (caustics), ripple rings, a line of foam
 * lapping the bank, and a few glints. All from world position and time: no textures.
 */
const POOL_DIFFUSE_PS = /* glsl */ `
uniform vec3 material_diffuse;
uniform float uPoolTime;
float sbPoolHash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void getAlbedo() {
	dAlbedo = material_diffuse.rgb;
	#ifdef STD_DIFFUSE_VERTEX
		dAlbedo *= saturate(vVertexColor.rgb);
	#endif
	float depth = clamp(vVertexColor.a, 0.0, 1.0);
	vec2 p = vPositionW.xz;
	float t = uPoolTime;
	// caustics: a few rounds of warped sines folded back on themselves give a drifting, organic net of light
	vec2 cp = mod(p * 1.9 * 6.2831853, 6.2831853) - 250.0;
	vec2 ci = cp;
	float cs = 1.0;
	for (int n = 0; n < 4; n++) {
		float ct = t * 0.5 * (1.0 - 3.5 / float(n + 1));
		ci = cp + vec2(cos(ct - ci.x) + sin(ct + ci.y), sin(ct - ci.y) + cos(ct + ci.x));
		cs += 1.0 / length(vec2(cp.x / (sin(ci.x + ct) / 0.005), cp.y / (cos(ci.y + ct) / 0.005)));
	}
	float net = clamp(pow(abs(1.17 - pow(cs / 4.0, 1.4)), 8.0), 0.0, 1.0);
	dAlbedo += vec3(0.55, 0.78, 0.72) * net * (0.22 + 0.3 * depth);
	// ripple rings spreading from a few seeded spots
	vec2 cell = floor(p * 0.5);
	vec2 c = (cell + 0.25 + 0.5 * vec2(sbPoolHash(cell), sbPoolHash(cell + 7.3))) * 2.0;
	float age = fract(t * 0.22 + sbPoolHash(cell + 3.1));
	float ring = (1.0 - smoothstep(0.0, 0.035, abs(distance(p, c) - age * 0.75))) * (1.0 - age) * step(0.25, depth);
	dAlbedo += vec3(0.5, 0.6, 0.6) * ring * 0.5;
	// foam lapping the bank, and a thinner line a little further out
	float lap = 0.085 + 0.03 * sin(t * 1.4 + p.x * 3.1 + p.y * 2.3);
	float foam = 1.0 - smoothstep(lap * 0.55, lap, depth);
	foam = max(foam, 0.45 * (1.0 - smoothstep(0.0, 0.02, abs(depth - lap * 1.9))));
	dAlbedo = mix(dAlbedo, vec3(0.86, 0.97, 1.0), foam * 0.8);
	// glints
	vec2 gp = p * 9.0 + vec2(t * 0.35, -t * 0.25);
	float tw = sbPoolHash(floor(gp));
	float glint = step(0.965, tw) * (0.5 + 0.5 * sin(t * 3.0 + tw * 40.0)) * (1.0 - smoothstep(0.0, 0.3, distance(fract(gp), vec2(0.5))));
	dAlbedo += vec3(glint * 0.9);
}
`;

/**
 * The High-tier reflection (owner, E23 polish): calm water picks up a soft wash of the sky, stronger as you look
 * across it (a Fresnel falloff), and a small glint where the sun or moon catches the ripples. Cheap: no planar
 * reflection and no extra pass, just the sky's horizon and upper colours (which Sky works out for the time of day,
 * so it goes dark blue at night) and the key light, read in the emission so it isn't dimmed by the lighting.
 * `uPoolReflect` 0 skips it entirely: Medium, Low and the Deck preset draw exactly what they did before.
 */
const POOL_REFLECT_GLSL = /* glsl */ `
uniform float uPoolReflect;
uniform vec3 uPoolSkyLow;
uniform vec3 uPoolSkyHigh;
uniform vec3 uPoolToLight;
uniform vec3 uPoolLight;
uniform vec3 look_camPos;
void addPoolReflect() {
#if defined(LIT_NEEDS_NORMAL) && defined(FORWARD_PASS)
	if (uPoolReflect > 0.0) {
		vec2 p = vPositionW.xz;
		float t = uPoolTime;
		// a faint swell so the reflection and the glint shimmer instead of sitting flat
		vec3 n = normalize(vec3(0.035 * sin(p.x * 5.3 + t * 1.1) + 0.02 * sin(p.y * 7.9 - t * 1.4), 1.0, 0.035 * sin(p.y * 4.7 + t * 0.9) + 0.02 * sin(p.x * 8.3 + t * 1.3)));
		vec3 v = normalize(look_camPos - vPositionW);
		vec3 r = reflect(-v, n);
		float ndv = clamp(dot(n, v), 0.0, 1.0);
		float fres = 0.1 + 0.55 * pow(1.0 - ndv, 3.0);
		vec3 sky = mix(uPoolSkyLow, uPoolSkyHigh, smoothstep(0.05, 0.7, r.y));
		// thinner right at the foamy bank, where the water is too shallow and broken to mirror much
		float depth = clamp(vVertexColor.a, 0.0, 1.0);
		float calm = smoothstep(0.08, 0.35, depth);
		float glint = pow(max(dot(r, uPoolToLight), 0.0), 220.0) * 2.2 + pow(max(dot(r, uPoolToLight), 0.0), 24.0) * 0.12;
		dEmission += (sky * fres + uPoolLight * glint) * calm * uPoolReflect;
	}
#endif
}
`;

let material: pc.StandardMaterial | undefined;

/** The emission chunk the device uses now (with the Look rim, when it is installed), plus the reflection. */
function reflectEmissive(device: pc.GraphicsDevice | undefined): string | undefined {
  if (!device || device.isWebGPU) return undefined;
  const stock = pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_GLSL).get('emissivePS');
  if (!stock) return undefined;
  const at = stock.lastIndexOf('}');
  // the rim chunk already declares the camera position; don't declare it twice
  const own = stock.includes('look_camPos') ? POOL_REFLECT_GLSL.replace('uniform vec3 look_camPos;\n', '') : POOL_REFLECT_GLSL;
  return own + stock.slice(0, at) + '\taddPoolReflect();\n' + stock.slice(at);
}

/** The shared clean-water surface material (vertex-coloured, glossy, lightly glowing). */
export function poolMaterial(device?: pc.GraphicsDevice): pc.StandardMaterial {
  if (material) return material;
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseVertexColor = true;
  m.useMetalness = true;
  m.metalness = 0;
  m.gloss = 0.9;
  const glow = new pc.Color();
  glow.fromString(PALETTE.aqua.water);
  m.emissive = glow;
  m.emissiveIntensity = 0.22;
  try {
    const chunks = m.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
    chunks.set('diffusePS', POOL_DIFFUSE_PS);
    const em = reflectEmissive(device);
    if (em) chunks.set('emissivePS', em);
  } catch {
    /* an engine without per-material chunks: still water with its depth gradient */
  }
  m.setParameter('uPoolTime', 0);
  m.setParameter('uPoolReflect', 0);
  m.setParameter('uPoolSkyLow', [0, 0, 0]);
  m.setParameter('uPoolSkyHigh', [0, 0, 0]);
  m.setParameter('uPoolToLight', [0, 1, 0]);
  m.setParameter('uPoolLight', [0, 0, 0]);
  m.update();
  return (material = m);
}

/** Advances the water (once per frame; hold the time still for reduced motion). */
export function updatePool(time: number) {
  material?.setParameter('uPoolTime', time);
}

/** Only the High graphics tier gets the reflection; Medium, Low and the Steam Deck preset keep the plain water. */
export function poolReflectOn(tier: GfxTier, deck: boolean): boolean {
  return tier === 'high' && !deck;
}

/** How strong the reflection is when it is on (the shader's `uPoolReflect`). */
export const POOL_REFLECT = 1;

export interface PoolSky {
  /** sky colours near the horizon and higher up, 0–1 sRGB (Sky.reflectColours) */
  low: readonly [number, number, number];
  high: readonly [number, number, number];
  /** unit vector toward the key light (the sun by day, the moon by night) */
  toLight: { x: number; y: number; z: number };
  /** the key light's colour, 0–1 sRGB, and its strength as a share of the noon sun's */
  light: { r: number; g: number; b: number };
  share: number;
}

const lin = (c: number) => Math.pow(Math.max(0, c), 2.2);
const low3 = [0, 0, 0];
const high3 = [0, 0, 0];
const dir3 = [0, 1, 0];
const light3 = [0, 0, 0];

/** Per frame: the reflection on or off (by the tier) and what it reflects. Off costs nothing: the shader skips it. */
export function setPoolReflect(on: boolean, sky?: PoolSky) {
  const m = material;
  if (!m) return;
  m.setParameter('uPoolReflect', on && sky ? POOL_REFLECT : 0);
  if (!on || !sky) return;
  for (let i = 0; i < 3; i++) {
    low3[i] = lin(sky.low[i]);
    high3[i] = lin(sky.high[i]);
  }
  dir3[0] = sky.toLight.x;
  dir3[1] = sky.toLight.y;
  dir3[2] = sky.toLight.z;
  // under the horizon the light can't glint off the water
  const up = Math.max(0, Math.min(1, sky.toLight.y * 6));
  const k = Math.max(0, Math.min(1, sky.share)) * up;
  light3[0] = lin(sky.light.r) * k;
  light3[1] = lin(sky.light.g) * k;
  light3[2] = lin(sky.light.b) * k;
  m.setParameter('uPoolSkyLow', low3);
  m.setParameter('uPoolSkyHigh', high3);
  m.setParameter('uPoolToLight', dir3);
  m.setParameter('uPoolLight', light3);
}

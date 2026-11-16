import * as pc from 'playcanvas';
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

let material: pc.StandardMaterial | undefined;

/** The shared clean-water surface material (vertex-coloured, glossy, lightly glowing). */
export function poolMaterial(): pc.StandardMaterial {
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
    m.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('diffusePS', POOL_DIFFUSE_PS);
  } catch {
    /* an engine without per-material chunks: still water with its depth gradient */
  }
  m.setParameter('uPoolTime', 0);
  m.update();
  return (material = m);
}

/** Advances the water (once per frame; hold the time still for reduced motion). */
export function updatePool(time: number) {
  material?.setParameter('uPoolTime', time);
}

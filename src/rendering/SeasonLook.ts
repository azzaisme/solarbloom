import { SEASON_LOOK, SEASON_LOOK_TIMING, SEASONS, type Season, type SeasonLookDef } from '../data/seasons';
import { PALETTE } from './Palette';

/**
 * #830: how the seasons look. Pure (no engine import), so tests can check it: `seasonLookAt` works out the look for a
 * moment of the year, and `SeasonShading` hands it to every material that shows it as a few uniforms, read by
 * `SEASON_GLSL` in their fragment shaders. No geometry is rebuilt when the season turns: the whole change is in the
 * shaders, so it costs the same on every graphics setting.
 *
 * - Green things (grass, lawns, shrubs, every leaf) drift toward the season's grass colour (`PALETTE.season.grass`):
 *   a fresh spring green, a golden autumn, a pale winter sage. Summer is the world's own green.
 * - Deciduous leaves (TreeGen SEASON_FLAG) blossom pink and white in spring, turn gold, orange and russet in autumn
 *   and fall in winter, leaving the branches bare (each leaf cell keeps its own colour and the moment it turns).
 * - Winter dusts every upward face with frost and light snow in soft patches, a little more at dawn and on snowy days.
 */

/** The look at one moment (data/seasons SeasonLookDef), plus the grass colour it drifts toward (linear RGB). */
export interface SeasonLookNow extends SeasonLookDef {
  grassColour: [number, number, number];
  /** snow lying on the garden, 0 … 1 (all white): built up over snowy winter days (Seasons.snowCover) */
  snow: number;
}

/** sRGB hex → linear RGB 0 … 1 (how the shaders compare colours). */
export function linear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2)) as [number, number, number];
}

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/**
 * The look for a moment of the year: `season` and `progress` (0 … 1 through it) from the sim's seasons, the game day's
 * fraction (0 dawn) and whether snow is falling. The last `SEASON_LOOK_TIMING.blend` of each season eases into the
 * next season's look, so nothing pops.
 */
export function seasonLookAt(season: Season, progress: number, dayFraction = 0.3, snowing = false, snowCover = 0): SeasonLookNow {
  const i = SEASONS.indexOf(season);
  const nextS = SEASONS[(i + 1) % SEASONS.length];
  const a = SEASON_LOOK[season];
  const b = SEASON_LOOK[nextS];
  const { blend, dawnFrost } = SEASON_LOOK_TIMING;
  const k = smooth((progress - (1 - blend)) / blend);
  const mix = (x: number, y: number) => x + (y - x) * k;
  const ga = linear(PALETTE.season.grass[season]);
  const gb = linear(PALETTE.season.grass[nextS]);
  const out: SeasonLookNow = {
    grass: mix(a.grass, b.grass),
    autumn: mix(a.autumn, b.autumn),
    bare: mix(a.bare, b.bare),
    blossom: mix(a.blossom, b.blossom),
    frost: mix(a.frost, b.frost),
    leafFall: mix(a.leafFall, b.leafFall),
    grassColour: [ga[0] + (gb[0] - ga[0]) * k, ga[1] + (gb[1] - ga[1]) * k, ga[2] + (gb[2] - ga[2]) * k],
    snow: Math.min(1, Math.max(0, snowCover)),
  };
  // a frosty winter morning, and fresh snow on a snowy day (only where there is frost already: winter)
  if (out.frost > 0) {
    const dawn = 1 - smooth(dayFraction / 0.22);
    out.frost = Math.min(1, out.frost + out.frost * dawnFrost * dawn + (snowing ? 0.15 : 0));
  }
  return out;
}

/** Something with uniforms (a PlayCanvas material). */
interface Uniforms {
  setParameter(name: string, data: number | number[] | Float32Array): void;
}

/** The uniform values for a look (the shader's names). */
export function seasonUniforms(look: SeasonLookNow): Record<string, number[]> {
  const S = PALETTE.season;
  return {
    uSeasonA: [look.grass, look.autumn, look.bare, look.blossom],
    uSeasonB: [look.frost, 1, look.snow ?? 0, 0],
    uSeasonGrass: look.grassColour,
    uSeasonAut0: linear(S.autumn[0]),
    uSeasonAut1: linear(S.autumn[1]),
    uSeasonAut2: linear(S.autumn[2]),
    uSeasonWither: linear(S.withered),
    uSeasonBlos0: linear(S.blossom[0]),
    uSeasonBlos1: linear(S.blossom[1]),
    uSeasonFrost: linear(S.frost),
  };
}

/**
 * The materials that show the seasons, and the look they show. `register` gives a material the current look at once
 * (a material made later still matches); `set` updates them all, only when the look has really changed.
 */
export class SeasonShading {
  private mats = new Set<Uniforms>();
  private values: Record<string, number[]> = seasonUniforms(seasonLookAt('summer', 0.3));
  private key = '';
  /** 1 on Medium and High, 0 on Low (the Steam Deck's): Low's frost takes one noise lookup instead of two */
  private detail = 1;

  /** The graphics tier (Game sets it with the others): Low draws the frost more cheaply. */
  setTier(t: 'low' | 'medium' | 'high') {
    const d = t === 'low' ? 0 : 1;
    if (d === this.detail) return;
    this.detail = d;
    this.values = { ...this.values, uSeasonB: [this.values.uSeasonB[0], d, this.values.uSeasonB[2], 0] };
    for (const m of this.mats) m.setParameter('uSeasonB', this.values.uSeasonB);
  }

  register(m: Uniforms) {
    this.mats.add(m);
    for (const [k, v] of Object.entries(this.values)) m.setParameter(k, v);
  }

  /** The look now; returns whether anything changed. */
  set(look: SeasonLookNow): boolean {
    const values = seasonUniforms(look);
    values.uSeasonB[1] = this.detail;
    const key = [...values.uSeasonA, ...values.uSeasonB, ...values.uSeasonGrass].map((v) => v.toFixed(4)).join(',');
    if (key === this.key) return false;
    this.key = key;
    this.values = values;
    for (const m of this.mats) for (const [k, v] of Object.entries(values)) m.setParameter(k, v);
    return true;
  }

  /** The look's uniform values now (tests and the e2e read them). */
  get current(): Readonly<Record<string, number[]>> {
    return this.values;
  }
}

/** The one season shading (the materials register with it; Game drives `set` each frame). */
export const seasonShading = new SeasonShading();

/**
 * The season's GLSL: uniforms and helpers, included once in a fragment shader's declarations.
 * - `sbSeasonColour(c, n, p)`: green tinted toward the season, frost on upward faces (any material)
 * - `sbSeasonLeaf(c, p)`: a deciduous leaf's blossom or autumn colour (foliage; `p` the leaf's rest position)
 * - `sbSeasonBare(p, big)`: true where a leaf has fallen (foliage opacity, both passes)
 */
export const SEASON_GLSL = /* glsl */ `
uniform vec4 uSeasonA; // grass shift, autumn, bare, blossom
uniform vec4 uSeasonB; // frost, detail (0 on Low), snow lying (0 … 1, all white), unused
uniform vec3 uSeasonGrass;
uniform vec3 uSeasonAut0;
uniform vec3 uSeasonAut1;
uniform vec3 uSeasonAut2;
uniform vec3 uSeasonWither;
uniform vec3 uSeasonBlos0;
uniform vec3 uSeasonBlos1;
uniform vec3 uSeasonFrost;
float sbsLum(vec3 c) {
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}
vec4 sbsHash4(vec3 p) {
	vec4 q = vec4(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)), dot(p, vec3(246.1, 124.6, 311.7)));
	return fract(sin(q) * 43758.5453);
}
float sbsNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
	float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
	float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
	float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// how green a colour is (linear): 0 for stone, wood, flowers and machines, 1 for grass and leaves
float sbsGreen(vec3 c) {
	float mx = max(c.r, max(c.g, c.b));
	float mn = min(c.r, min(c.g, c.b));
	float sat = (mx - mn) / max(mx, 0.001);
	return smoothstep(0.004, 0.03, c.g - max(c.r, c.b) * 0.95) * smoothstep(0.12, 0.25, sat);
}
vec3 sbSeasonColour(vec3 c, vec3 n, vec3 p) {
	if (uSeasonA.x > 0.001) {
		float g = sbsGreen(c);
		vec3 t = uSeasonGrass * (sbsLum(c) / max(sbsLum(uSeasonGrass), 0.001));
		c = mix(c, t, g * uSeasonA.x);
	}
	if (uSeasonB.x > 0.001 || uSeasonB.z > 0.001) {
		float up = smoothstep(0.35, 0.9, n.y);
		float nz = sbsNoise(p.xz * 2.1);
		if (uSeasonB.y > 0.5) nz = 0.65 * nz + 0.35 * sbsNoise(p.xz * 6.7 + 3.1);
		// lying snow widens the frost's patches until they join (past 1 every upward face is covered), and thickens it
		float cover = uSeasonB.x + uSeasonB.z * 1.3;
		float f = up * smoothstep(1.0 - cover, 1.0 - cover + 0.22, nz);
		c = mix(c, uSeasonFrost * mix(0.7, 0.88 + 0.07 * uSeasonB.z, up), f * (0.7 + 0.25 * uSeasonB.z));
	}
	return c;
}
// a deciduous leaf: one hashed cell per leaf, each with its own colour and the moment it turns
vec3 sbSeasonLeafB(vec3 c, vec3 p, float blossom);
vec3 sbSeasonLeaf(vec3 c, vec3 p) {
	return sbSeasonLeafB(c, p, 1.0);
}
// #785: as sbSeasonLeaf; blossom 0 keeps a leaf green in spring (a fruit tree flowers with flowers of its own)
vec3 sbSeasonLeafB(vec3 c, vec3 p, float blossom) {
	vec4 h = sbsHash4(floor(p * 7.0));
	float l = sbsLum(c);
	if (uSeasonA.y > 0.001) {
		// winter's last leaves have all turned
		float turn = max(clamp(uSeasonA.y * 1.6 - h.x * 0.6, 0.0, 1.0), smoothstep(0.4, 0.8, uSeasonA.z));
		vec3 ac = h.y < 0.4 ? uSeasonAut0 : (h.y < 0.75 ? uSeasonAut1 : uSeasonAut2);
		// winter's few last leaves are brown and dry
		ac = mix(ac, uSeasonWither, smoothstep(0.4, 0.8, uSeasonA.z));
		vec3 t = ac * clamp(l / max(sbsLum(ac), 0.001) * 1.7, 0.35, 1.25);
		c = mix(c, t, turn);
	}
	if (uSeasonA.w > 0.001 && blossom > 0.5) {
		float b = 1.0 - smoothstep(uSeasonA.w - 0.06, uSeasonA.w, h.z);
		vec3 bc = h.y < 0.62 ? uSeasonBlos0 : uSeasonBlos1;
		c = mix(c, bc * clamp(0.55 + l * 5.0, 0.6, 1.05), b);
	}
	return c;
}
// a fallen leaf: crowns thin from the outside cells in, never all at once (big: a far tree's leaf clump)
bool sbSeasonBare(vec3 p, float big) {
	if (uSeasonA.z <= 0.001) return false;
	vec4 h = sbsHash4(floor(p * mix(7.0, 3.0, big)));
	return h.w < uSeasonA.z;
}
`;

/**
 * #830: the colour of a leaf drifting down from a tree (linear bytes, as Vfx takes them): spring's blossom petals,
 * autumn's gold and red, winter's last brown leaves, or the tree's own green. `r1`, `r2`: two random numbers 0 … 1.
 */
export function fallingLeafColour(look: SeasonLookDef, own: [number, number, number], deciduous: boolean, r1: number, r2: number): [number, number, number] {
  if (!deciduous) return own;
  const S = PALETTE.season;
  const bytes = (hex: string) => linear(hex).map((v) => Math.round(v * 255)) as [number, number, number];
  if (r1 < look.blossom * 0.7) return bytes(S.blossom[r2 < 0.62 ? 0 : 1]);
  if (r1 < look.autumn) return bytes(look.bare > 0.5 ? S.withered : S.autumn[r2 < 0.4 ? 0 : r2 < 0.75 ? 1 : 2]);
  return own;
}

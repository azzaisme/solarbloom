import * as pc from 'playcanvas';
import { roadPlanFor, type RoadPiece, type RoadPlan } from '../core/RoadPlan';
import { CHUNK } from '../core/Hash';
import { GROUND } from '../core/GameState';
import { chunkKey } from '../core/Grid';
import { polyDist } from '../core/Picking';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { CITY_GEN, PARK_LAYOUT } from '../data/city';
import { RARE_PLANT_DEFAULT, RARE_PLANTS } from '../data/pulse';
import { buildingPlots, type BuildingPlot } from '../core/Generation';
import { PALETTE } from './Materials';
import { flowerAt, grassTone } from './Palette';
import { lowGeometry, vertexColourMaterial, type VPrim } from './Shapes';
import { plotsInChunk, type PlotSpot } from '../core/Plots';
import { inSurfBand, moveLandAt, onJetty, pileById, pondCell, regionWater, seaCell, setPieceAt, shallowSea, surfCell } from '../core/OldCityLayout';
import { addGroundFan, addGroundQuad, addGroundStrip, emptyGroundTexGeo, GROUND_TEXTURES, groundTexFor, groundTexMaterial, groundTexMesh, type GroundTexGeo, type GroundTexName } from './GroundTex';
import { oldCityModel } from './Models';
import { edgeHeight, levelAt, levelY, rampAt } from '../core/Height';
import { fitOnGround, geoRadius, type GroundFit } from './GroundFit';
import { LOOK } from '../data/look';
import { GATE_MODELS, LANDING, PARK_SET } from '../data/oldcity';
import { MATERIALS, SALVAGE } from '../data/salvage';
import { drawPlot } from './PlotArt';
import { drawDecor } from './DecorArt';
import type { Decoration } from '../core/Decor';
import { FoliageBuilder, foliageBounds, foliageMaterial, treeMesh, updateWind } from './Foliage';
import { shrubGeo, treeGeo, warmTemplates, type TreeGeo, type Lod } from './TreeGen';
import { treeSpot, treeStage } from './TreePlacement';
import { warmFlora, grassGeo, flowerGeo, leafyShrubGeo, tintGeo, vineGeo } from './Flora';
import { areaEdges, buildingDressing, flowerDrifts, grassTufts, hash01 as dhash, obstacleClutter, paving, planterBed, radiantExtras, thrivingExtras, turfTop, type DressCtx, type SolidSink } from './Surfaces';
import { MODELS, ModelBatch } from './Models';
import { SOLID_SINK, SolidCollector, SolidIndex } from '../core/Solids';
import { WATER, poolMaterial, updatePool } from './Water';
import { TrMeshBuilder } from './transitions/TrMeshBuilder';
import { transitionMaterial } from './transitions/TransitionMaterial';
import type { WarmupSample } from './ShaderWarmup';
import { chunkBuilders, type ChunkHost, type GeoSink, type Sink, type TransitionRenderer } from './transitions/TransitionRenderer';
import { MOVE_TRIPS } from '../data/moveSpots';

/** Small seeded RNG for decoration placement (looks only). */
class VRng {
  constructor(private s: number) {}
  next() {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
}

interface Template {
  pos: Float32Array;
  nrm: Float32Array;
  idx: Uint32Array;
  /** every normal lies along an axis (a box): scaling never changes their direction */
  axis: boolean;
}

const TEMPLATES = new Map<VPrim, Template>();
function template(type: VPrim): Template {
  let t = TEMPLATES.get(type);
  if (!t) {
    const g = lowGeometry(type);
    const nrm = new Float32Array(g.normals!);
    let axis = true;
    for (let i = 0; i < nrm.length; i += 3) if ((nrm[i] !== 0 ? 1 : 0) + (nrm[i + 1] !== 0 ? 1 : 0) + (nrm[i + 2] !== 0 ? 1 : 0) > 1) axis = false;
    t = { pos: new Float32Array(g.positions!), nrm, idx: new Uint32Array(g.indices!), axis };
    TEMPLATES.set(type, t);
  }
  return t;
}

/** A growable typed array (no per-element boxing; one copy per doubling). */
class Grow<T extends Float32Array | Uint8Array | Uint32Array> {
  n = 0;
  constructor(public a: T) {}
  reserve(k: number) {
    if (this.n + k <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + k) cap *= 2;
    const b = new (this.a.constructor as new (n: number) => T)(cap);
    b.set(this.a);
    this.a = b;
  }
  view(): T {
    return this.a.subarray(0, this.n) as T;
  }
}

const linCache = new Map<string, [number, number, number]>();
/** sRGB hex → linear 0–1 (matches the vertex-colour material). */
export function lin(hex: string): [number, number, number] {
  let c = linCache.get(hex);
  if (!c) {
    const col = new pc.Color();
    col.fromString(hex);
    c = [Math.pow(col.r, 2.2), Math.pow(col.g, 2.2), Math.pow(col.b, 2.2)];
    linCache.set(hex, c);
  }
  return c;
}

type V3 = [number, number, number];
const UP: V3 = [0, 1, 0];

/** Accumulates transformed primitives into one vertex-coloured mesh. */
/** E23.12.3: the box around some points (a quad, a triangle, a prism's ring), for the CPU line of sight. */
function pointsBox(...pts: readonly (readonly number[])[]) {
  return {
    x0: Math.min(...pts.map((q) => q[0])),
    y0: Math.min(...pts.map((q) => q[1])),
    z0: Math.min(...pts.map((q) => q[2])),
    x1: Math.max(...pts.map((q) => q[0])),
    y1: Math.max(...pts.map((q) => q[1])),
    z1: Math.max(...pts.map((q) => q[2])),
  };
}

export class MeshBuilder {
  private pos = new Grow(new Float32Array(1 << 15));
  private nrm = new Grow(new Float32Array(1 << 15));
  private col = new Grow(new Uint8Array(1 << 15));
  private idx = new Grow(new Uint32Array(1 << 14));
  /** 0 = full colour … 1 = fully grey (fog / desaturation) */
  grey = 0;
  /** Look 2.2: when set, colours fade from the given colour at the bottom of a primitive to this one at its top. */
  tip = '';

  /** `glow` (0-1, Look 1.9) makes the primitive emissive: stored in the vertex alpha, read by the vertex-colour material. */
  add(type: VPrim, hex: string, p: [number, number, number], s: [number, number, number] | number, glow = 0) {
    SOLID_SINK.current?.prim(p, s); // E23.12.3: what's drawn solid, for the CPU line of sight
    const t = template(type);
    let sx: number, sy: number, sz: number;
    if (typeof s === 'number') sx = sy = sz = s;
    else [sx, sy, sz] = s;
    const [R, G, B] = this.rgb(hex);
    const [R2, G2, B2] = this.tip ? this.rgb(this.tip) : [R, G, B];
    const A = 255 - Math.round(Math.min(1, Math.max(0, glow)) * 255);
    const nv = t.pos.length;
    const base = this.pos.n / 3;
    this.pos.reserve(nv);
    this.nrm.reserve(nv);
    this.col.reserve((nv / 3) * 4);
    this.idx.reserve(t.idx.length);
    const P = this.pos.a;
    const N = this.nrm.a;
    const C = this.col.a;
    const I = this.idx.a;
    let o = this.pos.n;
    let c = this.col.n;
    // Uniform scale or axis-aligned normals: the direction survives scaling, so copy it.
    const copy = t.axis || (sx === sy && sy === sz);
    for (let i = 0; i < nv; i += 3, o += 3, c += 4) {
      P[o] = p[0] + t.pos[i] * sx;
      P[o + 1] = p[1] + t.pos[i + 1] * sy;
      P[o + 2] = p[2] + t.pos[i + 2] * sz;
      if (copy) {
        N[o] = t.nrm[i];
        N[o + 1] = t.nrm[i + 1];
        N[o + 2] = t.nrm[i + 2];
      } else {
        // non-uniform scale: approximate normals by inverse scale, renormalised
        const nx = t.nrm[i] / sx;
        const ny = t.nrm[i + 1] / sy;
        const nz = t.nrm[i + 2] / sz;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        N[o] = nx / len;
        N[o + 1] = ny / len;
        N[o + 2] = nz / len;
      }
      if (this.tip) {
        const k = Math.max(0, Math.min(1, t.pos[i + 1] + 0.5));
        C[c] = R + (R2 - R) * k;
        C[c + 1] = G + (G2 - G) * k;
        C[c + 2] = B + (B2 - B) * k;
      } else {
        C[c] = R;
        C[c + 1] = G;
        C[c + 2] = B;
      }
      C[c + 3] = A;
    }
    this.pos.n = this.nrm.n = o;
    this.col.n = c;
    let k = this.idx.n;
    for (let i = 0; i < t.idx.length; i++) I[k++] = base + t.idx[i];
    this.idx.n = k;
    this.tris += t.idx.length / 3;
  }

  private shade(r: number, g: number, b: number): [number, number, number] {
    if (this.grey > 0) {
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      const k = this.grey;
      r = r + (l * 0.85 - r) * k;
      g = g + (l * 0.88 - g) * k;
      b = b + (l * 0.95 - b) * k;
    }
    return [r, g, b];
  }

  /** Look 3: stamps a cached template (flex ignored: solid props don't sway), turned about Y and scaled. */
  addGeo(g: TreeGeo, x: number, y: number, z: number, rotY: number, scale: number) {
    SOLID_SINK.current?.geo(foliageBounds(g), x, y, z, scale);
    const nv = g.pos.length / 4;
    const base = this.pos.n / 3;
    this.pos.reserve(nv * 3);
    this.nrm.reserve(nv * 3);
    this.col.reserve(nv * 4);
    this.idx.reserve(g.idx.length);
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const P = this.pos.a, N = this.nrm.a, C = this.col.a, I = this.idx.a;
    let o = this.pos.n, k = this.col.n;
    const grey = this.grey > 0;
    for (let i = 0; i < nv; i++, o += 3, k += 4) {
      const px = g.pos[i * 4], pz = g.pos[i * 4 + 2];
      P[o] = x + (px * c - pz * s) * scale;
      P[o + 1] = y + g.pos[i * 4 + 1] * scale;
      P[o + 2] = z + (px * s + pz * c) * scale;
      const nx = g.nrm[i * 3], nz = g.nrm[i * 3 + 2];
      N[o] = nx * c - nz * s;
      N[o + 1] = g.nrm[i * 3 + 1];
      N[o + 2] = nx * s + nz * c;
      if (grey) {
        const [r, gg, b] = this.shade(g.col[i * 4] / 255, g.col[i * 4 + 1] / 255, g.col[i * 4 + 2] / 255);
        C[k] = Math.round(r * 255);
        C[k + 1] = Math.round(gg * 255);
        C[k + 2] = Math.round(b * 255);
      } else {
        C[k] = g.col[i * 4];
        C[k + 1] = g.col[i * 4 + 1];
        C[k + 2] = g.col[i * 4 + 2];
      }
      C[k + 3] = 255;
    }
    this.pos.n = this.nrm.n = o;
    this.col.n = k;
    let q = this.idx.n;
    for (let i = 0; i < g.idx.length; i++) I[q++] = base + g.idx[i];
    this.idx.n = q;
    this.tris += g.tris;
  }

  /** Look 3.3: an upward quad with its own colour per corner (linear 0–1), for blended lawn tops. */
  quad(p: number[], cols: number[]) {
    if (SOLID_SINK.current) SOLID_SINK.current.box(pointsBox([p[0], p[1], p[2]], [p[3], p[4], p[5]], [p[6], p[7], p[8]], [p[9], p[10], p[11]]));
    const base = this.pos.n / 3;
    this.pos.reserve(12);
    this.nrm.reserve(12);
    this.col.reserve(16);
    this.idx.reserve(6);
    for (let i = 0; i < 4; i++) {
      const o = this.pos.n + i * 3;
      this.pos.a[o] = p[i * 3];
      this.pos.a[o + 1] = p[i * 3 + 1];
      this.pos.a[o + 2] = p[i * 3 + 2];
      this.nrm.a[o] = 0;
      this.nrm.a[o + 1] = 1;
      this.nrm.a[o + 2] = 0;
      const [r, g, b] = this.shade(cols[i * 3], cols[i * 3 + 1], cols[i * 3 + 2]);
      const k = this.col.n + i * 4;
      this.col.a[k] = Math.round(Math.min(1, r) * 255);
      this.col.a[k + 1] = Math.round(Math.min(1, g) * 255);
      this.col.a[k + 2] = Math.round(Math.min(1, b) * 255);
      this.col.a[k + 3] = 255;
    }
    this.pos.n += 12;
    this.nrm.n += 12;
    this.col.n += 16;
    // corners run (x0,z0) (x0,z1) (x1,z1) (x1,z0): counter-clockwise seen from above
    const I = this.idx.a;
    let q = this.idx.n;
    I[q++] = base; I[q++] = base + 1; I[q++] = base + 2;
    I[q++] = base; I[q++] = base + 2; I[q++] = base + 3;
    this.idx.n = q;
    this.tris += 2;
  }

  /** One flat-shaded triangle (world positions), wound so it faces along `n`. */
  tri(hex: string, a: V3, b: V3, c: V3, n: V3) {
    if (SOLID_SINK.current) SOLID_SINK.current.box(pointsBox(a, b, c));
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const facing = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    if (facing < 0) [b, c] = [c, b];
    const [R, G, B] = this.rgb(hex);
    const base = this.pos.n / 3;
    this.pos.reserve(9);
    this.nrm.reserve(9);
    this.col.reserve(12);
    this.idx.reserve(3);
    let o = this.pos.n;
    let k = this.col.n;
    for (const p of [a, b, c]) {
      this.pos.a[o] = p[0];
      this.pos.a[o + 1] = p[1];
      this.pos.a[o + 2] = p[2];
      this.nrm.a[o] = n[0];
      this.nrm.a[o + 1] = n[1];
      this.nrm.a[o + 2] = n[2];
      o += 3;
      this.col.a[k] = R;
      this.col.a[k + 1] = G;
      this.col.a[k + 2] = B;
      this.col.a[k + 3] = 255;
      k += 4;
    }
    this.pos.n = this.nrm.n = o;
    this.col.n = k;
    for (let i = 0; i < 3; i++) this.idx.a[this.idx.n++] = base + i;
    this.tris++;
  }

  /**
   * A flat-topped piece from an outline: a top fan from `o` over the ring at `yTop`, and a wall down to `yBot` under
   * each ring segment, facing away from `o`. Used for the rounded banks of pools.
   */
  prism(hex: string, o: [number, number], ring: [number, number][], closed: boolean, yTop: number, yBot: number) {
    if (SOLID_SINK.current && ring.length) SOLID_SINK.current.box(pointsBox(...ring.flatMap(([x, z]) => [[o[0] + x, yBot, o[1] + z], [o[0] + x, yTop, o[1] + z]] as V3[])));
    const n = closed ? ring.length : ring.length - 1;
    for (let i = 0; i < n; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      let nx = q[1] - p[1];
      let nz = -(q[0] - p[0]);
      const len = Math.hypot(nx, nz);
      if (len < 1e-6) continue;
      this.tri(hex, [o[0], yTop, o[1]], [p[0], yTop, p[1]], [q[0], yTop, q[1]], UP);
      nx /= len;
      nz /= len;
      if (nx * ((p[0] + q[0]) / 2 - o[0]) + nz * ((p[1] + q[1]) / 2 - o[1]) < 0) [nx, nz] = [-nx, -nz];
      const N: V3 = [nx, 0, nz];
      this.tri(hex, [p[0], yTop, p[1]], [q[0], yTop, q[1]], [q[0], yBot, q[1]], N);
      this.tri(hex, [p[0], yTop, p[1]], [q[0], yBot, q[1]], [p[0], yBot, p[1]], N);
    }
  }

  /** triangles added (perf readout) */
  tris = 0;

  /** A colour as 0–255 linear vertex channels, greyed for fog. */
  private rgb(hex: string): [number, number, number] {
    const [r, g, b] = this.shade(...lin(hex));
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  build(device: pc.GraphicsDevice): pc.Mesh | undefined {
    if (!this.idx.n) return undefined;
    const m = new pc.Mesh(device);
    m.setPositions(this.pos.view());
    m.setNormals(this.nrm.view());
    m.setColors32(this.col.view());
    m.setIndices(this.idx.view());
    m.update(pc.PRIMITIVE_TRIANGLES);
    return m;
  }
}

/** Ground colours per material, dead → alive (Look 2: PALETTE.ground / PALETTE.lawn). */
const DEAD = PALETTE.ground.dead;
/** E21.5: the gate models' length in metres (#379), so a gate model can be fitted to its cells. */
const GATE_LENGTH: Record<string, number> = { barricade: 4, 'bridge-broken': 14, 'bridge-repaired': 14, 'skybridge-collapsed': 12, 'lift-bridge': 6, 'glide-perch': 1.2 };
const EDGE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/**
 * Curved paths: the radius of the quarter circle that rounds a path's corner (half a tile: stepped tiles join into
 * one curve), segments per corner, how far the piece stands above the tile top (restored / not), and the width of
 * the white border along the curve.
 */
const PATH_CURVE = { radius: 0.5, arc: 6, lift: 0.052, liftDead: 0.012, border: 0.07 };
/**
 * Dead paving stands a little above the earth beside it: how far its painted top is raised (a stone lip shows along
 * its edges and curves), and the soft contact shadow on the ground beside the lip (width in tiles, darkest tint).
 */
const PAVING_RAISE = { lift: 0.03, shadow: 0.13, dark: 0.58 };
/** City 16.6: the four sides of a road tile and their piece-mask bits (RoadPlan.pieceAt). */
const ROAD_SIDES = [
  [1, 0, 1],
  [-1, 0, 2],
  [0, 1, 4],
  [0, -1, 8],
] as const;
const hash01 = (x: number, z: number, salt: number) => {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
const ALIVE = PALETTE.ground.alive;
/** The slab colours under a painted dead tile (the painting's average), or undefined where none is painted. */
const PAINTED_DEAD: Record<string, string[]> = PALETTE.ground.painted;
function paintedDead(t: TileData): string[] | undefined {
  if (t.level === undefined) return undefined;
  const g = groundTexFor(t.feature);
  if (g === 'sand' && moveLandAt(t.x, t.z)) return PALETTE.ground.wetSand; // #626: the sandbar's wet sand
  return g ? PAINTED_DEAD[g] : undefined;
}
/** #626: the vertex tint on a tile's painted ground: the sandbar's sand is wet and darker than the beach's. */
function paintTint(t: TileData, k: number): [number, number, number] {
  if (!moveLandAt(t.x, t.z)) return [k, k, k];
  const c = new pc.Color().fromString(PALETTE.ground.wetSandTint);
  return [Math.round(c.r * k), Math.round(c.g * k), Math.round(c.b * k)];
}
const CORNERS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
interface PoolGeo {
  pos: number[];
  col: number[];
  idx: number[];
}

interface ChunkView {
  key: string;
  cx: number;
  cz: number;
  ground?: pc.Entity;
  /** Phase 5: trees and shrubs (merged, vertex-coloured, swaying in the wind) */
  trees?: pc.Entity;
  fog?: pc.Entity;
  fogMat?: pc.StandardMaterial;
  dirty: boolean;
  fogDirty: boolean;
  fading?: boolean;
  /** built at far level of detail (slabs only) */
  far?: boolean;
  /** Look 3.17: zoom band it was built for (1 mid, 2 near) */
  band?: number;
  /** Look 4.9: drawn sunk below the revealed city (an area not revealed yet) */
  sunk?: boolean;
  /** Look 3.19: the chunk's hand-built models (props, clutter, planters), hardware-instanced */
  models?: pc.Entity;
  /** clean pool water: its own animated surface */
  water?: pc.Entity;
  /** painted ground (GroundTex): one mesh per texture over the chunk's dead sand and dead earth */
  gtex?: (pc.Entity | undefined)[];
  /** near skyscrapers, each its own meshes so it can fade when it blocks the view */
  towers?: Tower[];
  modelVBs?: pc.VertexBuffer[];
  /** Look 6.12: the living surface (every ground slab) and the props of tiles mid-transition */
  surface?: pc.Entity;
  trans?: pc.Entity;
  /** Look 6.12: when the last transition drawn in this chunk ends (visual clock); 0 = none */
  trEnd?: number;
  /** Look 6.18: last rebuild during an area wave */
  waveAt?: number;
  /** Look 6.18: the fog is rolling back as a front (kept until the wave ends, then rebuilt) */
  fogHold?: boolean;
}

/** A skyscraper drawn on its own (near chunks): its axis, its meshes and how see-through it is right now. */
interface Tower {
  x: number;
  z: number;
  base: number;
  top: number;
  /** half its width */
  r: number;
  entities: pc.Entity[];
  mis: pc.MeshInstance[];
  /** opacity now and where it is heading (1 solid) */
  a: number;
  to: number;
}

/** How see-through a skyscraper gets when it stands between the camera and the cursor or the view's focus. */
const TOWER_FADE = { opacity: 0.1, speed: 9 };
/** Height of the jetty model's deck above its base, in model metres (measured from its upward faces) */
const JETTY_DECK = 1.7;

let towerMat: pc.StandardMaterial | undefined;
/** The chunk material with dithered opacity (no sorting, still writes depth): each tower sets its own opacity. */
function towerMaterial(): pc.StandardMaterial {
  if (towerMat) return towerMat;
  const m = vertexColourMaterial().clone();
  m.opacityDither = pc.DITHER_BAYER8;
  m.opacityShadowDither = pc.DITHER_NONE;
  m.update();
  return (towerMat = m);
}

/** Look 6.18: fog opacity with a receding front (a circle growing from the landmark, with a wobbly edge). */
const FOG_FRONT_PS = /* glsl */ `
uniform float material_opacity;
uniform float material_alphaDitherScale;
uniform vec4 uFogFront;
void getOpacity() {
	dAlpha = material_opacity;
	#ifdef STD_OPACITY_VERTEX
	dAlpha *= clamp(vVertexColor.a, 0.0, 1.0);
	#endif
	if (uFogFront.w > 0.0) {
		float d = distance(vPositionW.xz, uFogFront.xy);
		float wob = sin(vPositionW.x * 1.3 + vPositionW.z * 0.7) * 0.9 + sin(vPositionW.z * 2.1 - vPositionW.x * 0.4) * 0.5;
		dAlpha *= smoothstep(uFogFront.z - uFogFront.w, uFogFront.z + uFogFront.w * 0.5, d + wob);
	}
}
`;

/**
 * Look 4.9 (#153): how far unrevealed areas sit below the revealed city. The early city (the park, then the
 * suburbs) is at street level, so this is a low step: the revealed ground reads as a place with a stone kerb
 * at its edge, not a rooftop. Revealing an area raises it to the city level. Picking of sunk (hidden) ground
 * uses the same depth (`Game.pick`). A drop of `TALL_DROP` or more draws a full building facade instead (for
 * the skyscraper stage later in the game).
 */
export const SINK = 0.45;
const TALL_DROP = 2;

/**
 * E21.24: the level a retaining wall on cell (x, z)'s edge facing (dx, dz) drops to, or undefined when there's no
 * wall there (the neighbour is as high or higher, or this cell is a ramp's side). Beside a ramp the wall drops to
 * the ramp's lowest point.
 */
export function wallDrop(x: number, z: number, dx: number, dz: number): number | undefined {
  const mine = edgeHeight(x, z, dx, dz);
  if (typeof mine !== 'number') return undefined;
  const theirs = edgeHeight(x + dx, z + dz, -dx, -dz);
  const ramp = rampAt(x + dx, z + dz)?.ramp;
  const low = typeof theirs === 'number' ? theirs : ramp ? Math.min(ramp.from, ramp.to) : mine;
  return low < mine - 1e-6 ? low : undefined;
}

/**
 * #648: whether the wall on cell (x, z)'s edge facing (dx, dz) runs on into the next cell along it, toward -1 and
 * +1 (the same height, the same drop on the same side, and no weir there). Where it doesn't, the wall ends or turns
 * a corner, and its stones reach on past the cell to close the corner.
 */
export function wallRuns(x: number, z: number, dx: number, dz: number, weir: (x: number, z: number, dx: number, dz: number) => boolean): [boolean, boolean] {
  const ax = dz ? 1 : 0;
  const az = dx ? 1 : 0;
  const runs = (k: number) => {
    const nx = x + ax * k;
    const nz = z + az * k;
    return !rampAt(nx, nz) && levelAt(nx, nz) === levelAt(x, z) && wallDrop(nx, nz, dx, dz) !== undefined && !weir(nx, nz, dx, dz);
  };
  return [runs(-1), runs(1)];
}

/**
 * Renders the endless city ground: one merged, vertex-coloured mesh per 16×16 chunk (slabs + decoration),
 * streamed in around the camera and rebuilt within a per-frame budget when its tiles change, plus a per-tile
 * fog mesh that hangs over fogged areas and recedes tile by tile as the player restores.
 */
export class ChunkRenderer {
  private views = new Map<string, ChunkView>();
  /** E21.22: how far a building in front of the view fades (the Old City's exploration camera: to 30%) */
  fadeTo = TOWER_FADE.opacity;
  private root: pc.Entity;
  reducedMotion = false;
  /** Max chunk meshes rebuilt per frame (keeps frames smooth while panning or during big chains). */
  /** most chunk rebuilds per frame, and the time they may take (ms) */
  budget = 4;
  budgetMs = 6;
  private time = 0;
  private lastFocus = { x: 8, z: 8 };
  /** Look 3.17: current zoom band (1 mid, 2 near) */
  private band = 1;
  /** Look 3.16: freeze the wind (deterministic screenshots: `?still`) */
  static still = typeof location !== 'undefined' && /[?&]still/.test(location.search);

  constructor(
    private sim: Sim,
    parent: pc.Entity,
    private device: pc.GraphicsDevice,
  ) {
    this.root = new pc.Entity('city-ground');
    parent.addChild(this.root);
  }

  get loadedCount() {
    return this.views.size;
  }

  /** E22.12: chunks in view still waiting to be built or rebuilt (the loading screen waits for none). */
  get pending(): number {
    let n = 0;
    for (const v of this.views.values()) if (v.dirty || v.fogDirty) n++;
    return n;
  }

  /** Third person: chunks waiting within `radius` world units of a point (the ground round bloombot). */
  pendingNear(f: { x: number; z: number }, radius: number): number {
    let n = 0;
    for (const v of this.views.values()) if ((v.dirty || v.fogDirty) && dist(v, f) <= radius) n++;
    return n;
  }

  /** A tile changed: rebuild its chunk (and fog) soon. */
  markTile(t: TileData) {
    if (t.roofId !== GROUND) return;
    const v = this.views.get(chunkKey(GROUND, Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK)));
    if (v) {
      v.dirty = true;
      v.fogDirty = true;
    }
    // Fog alpha is smoothed across tile corners, so neighbouring chunks may need a fog refresh too.
    const lx = t.x - Math.floor(t.x / CHUNK) * CHUNK;
    const lz = t.z - Math.floor(t.z / CHUNK) * CHUNK;
    if (lx === 0 || lz === 0 || lx === CHUNK - 1 || lz === CHUNK - 1)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = this.views.get(chunkKey(GROUND, Math.floor((t.x + dx) / CHUNK), Math.floor((t.z + dz) / CHUNK)));
        if (n) n.fogDirty = true;
      }
  }

  /** E23.4.4: rebuild every chunk touching these tile bounds (inclusive). */
  markRect(x0: number, z0: number, x1: number, z1: number) {
    for (let cz = Math.floor(z0 / CHUNK); cz <= Math.floor(z1 / CHUNK); cz++)
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        const v = this.views.get(chunkKey(GROUND, cx, cz));
        if (v) v.dirty = true;
      }
  }

  /** Where an area's wave starts (its landmark) and how far it has to roll. */
  private waveFrom(id: string): [number, number, number] {
    const info = this.sim.areas.info(id);
    const [lx, lz] = info.landmark;
    let radius = 0;
    for (const [cx, cz] of info.chunks) radius = Math.max(radius, Math.hypot(cx * CHUNK + CHUNK / 2 - lx, cz * CHUNK + CHUNK / 2 - lz) + CHUNK * 0.71);
    return [lx, lz, radius];
  }

  /** An area's fog state changed: refresh its chunks (and their neighbours, for soft edges). */
  markArea(id: string, fade = false) {
    const tr = this.transitions;
    if (fade && tr && !this.reducedMotion) {
      // Look 6.18: the clear rolls out from the landmark: props wake, ground un-greys, fog recedes as a front.
      const [lx, lz, radius] = this.waveFrom(id);
      tr.areaWave(id, lx + 0.5, lz + 0.5, radius);
    }
    for (const [cx, cz] of this.sim.areas.info(id).chunks)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const v = this.views.get(chunkKey(GROUND, cx + dx, cz + dz));
          if (!v) continue;
          v.dirty = true;
          if (fade && dx === 0 && dz === 0 && v.fogMat && !this.reducedMotion) {
            if (tr) v.fogHold = true;
            else v.fading = true;
          }
          else v.fogDirty = true;
        }
  }

  /** Settings → Simple fog: one fog layer instead of two. */
  lowFog = false;

  /** Look 3.17: quality tier for foliage, grass and prop density (low | medium | high). */
  detail: 'low' | 'medium' | 'high' = 'high';
  setDetail(t: 'low' | 'medium' | 'high') {
    if (t === this.detail) return;
    this.detail = t;
    this.markAll();
  }

  markAll() {
    for (const v of this.views.values()) {
      v.dirty = true;
      v.fogDirty = true;
    }
  }

  /**
   * Streams chunks for the visible ground rectangle (world x/z), keeping a margin loaded and dropping
   * chunks further away. Rebuilds at most `budget` dirty chunks per frame, nearest first.
   */
  /** Chunks further than this (in chunks) from the view centre draw as plain slabs when zoomed out. */
  farFrom = Infinity;

  /** City 05.2: the park's current look (0 dilapidated … 4 lush); a change rebuilds the park chunk. */
  parkStage = -1;
  /** Called when the park's stage rises (Game shows a line and a sparkle). */
  onParkStage?: (stage: number, prev: number) => void;

  update(dt: number, rect: { x0: number; x1: number; z0: number; z1: number; poly?: [number, number][] }, focus: { x: number; z: number }, zoom = 1) {
    this.time += dt;
    this.warmTrees();
    this.tickGrowing(dt);
    // Phase 5 / Look 3.16: foliage, grass, flowers, vines and banners sway; still with reduced motion or `?still`
    updateWind(ChunkRenderer.still ? 0 : this.time, this.reducedMotion || ChunkRenderer.still ? 0 : 1);
    if (!this.reducedMotion && !ChunkRenderer.still) updatePool(this.time);
    const ps = this.sim.grid.isPlayable(GROUND) ? this.sim.progression.parkStage() : 0;
    if (ps !== this.parkStage) {
      const prev = this.parkStage;
      this.parkStage = ps;
      const v = this.views.get(chunkKey(GROUND, 0, 0));
      if (v) v.dirty = true;
      if (prev >= 0 && ps > prev) this.onParkStage?.(ps, prev);
      // Look 3.8 (#135): from stage 3 the park's edges come alive (ivy, banners); they grow in as a wave from the
      // fountain instead of popping. Edges only: the ground and obstacles keep their own transitions.
      if (prev >= 0 && ps > prev && ps >= 3 && this.transitions && !this.reducedMotion) {
        const [lx, lz, radius] = this.waveFrom('park');
        this.transitions.areaWave('park', lx + 0.5, lz + 0.5, radius, { from: prev, edgesOnly: true });
      }
    }
    // Zoomed out, all but the middle draw as plain slabs; close up, the low view reaches deep into the haze, so
    // chunks well past the focus (where the haze is thick) do too. Mid zooms keep full detail (no LOD churn while panning).
    this.farFrom = zoom < 0.55 ? 2 : zoom >= 0.9 ? 3.2 : Infinity;
    // Look 3.17: grass, flowers and clutter thin out between the near and mid zoom bands (hysteresis avoids churn)
    // 3 = super close (trees get individual leaves on their clusters)
    if (zoom > 2.5) this.band = 3;
    else if (zoom > 1.3 && (this.band !== 3 || zoom < 2.3)) this.band = 2;
    else if (zoom < 1.15) this.band = 1;
    for (const v of this.views.values()) {
      const far = dist(v, focus) / CHUNK > this.farFrom;
      if (v.ground && (!!v.far !== far || (!far && v.band !== this.band))) v.dirty = true;
    }
    const cx0 = Math.floor(rect.x0 / CHUNK) - 1;
    const cx1 = Math.floor(rect.x1 / CHUNK) + 1;
    const cz0 = Math.floor(rect.z0 / CHUNK) - 1;
    const cz1 = Math.floor(rect.z1 / CHUNK) + 1;
    // Look 4.11: only chunks near the view's ground trapezoid (not its whole bounding box), with hysteresis.
    const poly = rect.poly;
    const near = (cx: number, cz: number, margin: number) => !poly || polyDist(poly, cx * CHUNK + CHUNK / 2, cz * CHUNK + CHUNK / 2) <= CHUNK * 0.71 + margin;
    const want = new Set<string>();
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!near(cx, cz, 4)) continue;
        const key = chunkKey(GROUND, cx, cz);
        want.add(key);
        if (!this.views.has(key)) this.views.set(key, { key, cx, cz, dirty: true, fogDirty: true });
      }
    // Drop chunks well outside the view (one extra ring of hysteresis).
    for (const [key, v] of this.views) {
      if (want.has(key)) continue;
      if (v.cx < cx0 - 1 || v.cx > cx1 + 1 || v.cz < cz0 - 1 || v.cz > cz1 + 1 || !near(v.cx, v.cz, 24)) this.drop(v);
    }
    // Fog fades (area cleared): opacity → 0, then rebuild.
    for (const v of this.views.values()) {
      if (!v.fading || !v.fogMat) continue;
      v.fogMat.opacity = Math.max(0, v.fogMat.opacity - dt * 0.8);
      v.fogMat.update();
      if (v.fogMat.opacity <= 0) {
        v.fading = false;
        v.fogDirty = true;
      }
    }
    this.lastFocus = focus;
    // Look 6.12: a chunk whose last transition ended folds its tiles back into the static mesh (one rebuild); one
    // inside a rolling area wave rebuilds a few times a second so the wave front advances.
    const tr = this.transitions;
    if (tr) {
      this.fogFronts();
      for (const v of this.views.values()) {
        if (v.dirty || !v.ground) continue;
        if (v.trEnd && tr.time >= v.trEnd) {
          v.trEnd = 0;
          v.dirty = true;
        } else if (v.waveAt !== undefined) {
          const a = this.sim.areas.map.areaOfChunk(v.cx, v.cz);
          if (!tr.waving(a)) {
            v.waveAt = undefined;
            v.dirty = true;
          } else if (tr.time - v.waveAt > 0.2) v.dirty = true;
        }
      }
    }
    const dirty = [...this.views.values()].filter((v) => v.dirty || (v.fogDirty && !v.fading && !v.fogHold));
    dirty.sort((a, b) => dist(a, focus) - dist(b, focus));
    // Rebuild nearest first, within a time budget (at least one per frame so streaming always progresses).
    const t0 = performance.now();
    const over = () => performance.now() - t0 > this.budgetMs;
    // City 15.4: the camera left the chunk being built (it was dropped above): abandon the job.
    if (this.job && this.views.get(this.job.v.key) !== this.job.v) this.job = undefined;
    let n = 0;
    if (!this.job || this.runJob(over))
      for (const v of dirty) {
        if (n >= this.budget || (n > 0 && over())) break;
        if (v.dirty) {
          this.job = { v, steps: this.buildGround(v) };
          if (!this.runJob(over)) break; // carries on next frame
        }
        if (v.fogDirty && !v.fading && !v.fogHold) this.buildFog(v);
        n++;
      }
    // Gentle drift of the fog sheets.
    if (!this.reducedMotion)
      for (const v of this.views.values()) if (v.fog) v.fog.setLocalPosition(0, Math.sin(this.time * 0.4 + v.cx * 0.7 + v.cz) * 0.04, 0);
  }

  private drop(v: ChunkView) {
    this.solids.clearChunk(v.key);
    this.dropModels(v);
    v.surface?.destroy();
    v.trans?.destroy();
    this.transitions?.liveByChunk.delete(v.key);
    v.ground?.destroy();
    v.water?.destroy();
    v.gtex?.forEach((e) => e?.destroy());
    for (const t of v.towers ?? []) for (const e of t.entities) e.destroy();
    v.trees?.destroy();
    v.fog?.destroy();
    this.treeTris.delete(v.key);
    this.groundTris.delete(v.key);
    this.views.delete(v.key);
  }

  private dropModels(v: ChunkView) {
    v.models?.destroy();
    for (const vb of v.modelVBs ?? []) vb.destroy();
    v.models = undefined;
    v.modelVBs = undefined;
  }

  /**
   * Look 3.19: this chunk's model copies (none in deep fog: hidden ground keeps its cheap grey shapes). The batch
   * culls as one box round the chunk.
   */
  private setModels(v: ChunkView, h: number) {
    this.dropModels(v);
    const batch = this.batch;
    this.batch = undefined;
    if (!batch?.count) return;
    const bounds = new pc.BoundingBox(new pc.Vec3(v.cx * CHUNK + CHUNK / 2, h + 3, v.cz * CHUNK + CHUNK / 2), new pc.Vec3(CHUNK / 2 + 2, 6, CHUNK / 2 + 2));
    const { entity, buffers, tris } = batch.build(this.device, bounds, !v.far);
    if (!entity) return;
    this.root.addChild(entity);
    v.models = entity;
    v.modelVBs = buffers;
    this.groundTris.set(v.key, (this.groundTris.get(v.key) ?? 0) + tris);
  }

  /** Look 3.19: the chunk being built collects model copies here (undefined: draw everything procedurally). */
  private batch?: ModelBatch;

  /**
   * E19.1.5 (#251): what each plot looks like, from the game (the renderer never reads choices itself): an option
   * id, null for the empty "waiting" look, undefined to draw nothing (not restored yet, or a machine on it).
   */
  plots?: {
    look(p: PlotSpot): string | null | undefined;
    /** E27.2 (#680): how grown back a worked plot is, 0 just picked or pruned to 1 ready (default 1) */
    growth?(p: PlotSpot): number;
  };
  /** Cells of the chunk being built that a chosen plot covers (their own grass and flowers stay flat under it). */
  private plotCells = new Set<string>();
  private chunkPlots: { p: PlotSpot; look: string | null; growth: number }[] = [];

  /**
   * E19.2 (#255): the decorations standing in a ground chunk, from the game. Drawn into the chunk's own meshes and
   * model batch like plots, so they cost no extra draw calls and stream with the chunk.
   */
  decor?: { inChunk(cx: number, cz: number): readonly Decoration[] };

  /** E19.1.5: redraw the chunk holding a plot (its choice or preview changed). */
  markPlot(p: PlotSpot) {
    const t = this.sim.grid.peek(GROUND, p.x, p.z);
    if (t) this.markTile(t);
  }

  /**
   * Look 3.19: an obstacle prop as its hand-built model: model, scale (to the procedural prop's size) and whether
   * its turn is seeded (props that face the street keep theirs).
   */
  private static readonly PROP_MODELS: Record<string, [string, number, boolean]> = {
    bench: ['bench', 0.58, false],
    lamp: ['lamp-post', 0.44, true],
    barrel: ['barrel', 0.62, true],
    bollard: ['bollard', 0.66, true],
    pillar: ['cracked-pillar', 0.55, true],
    post: ['mooring-post', 0.62, true],
    stall: ['market-stall', 0.54, false],
    drain: ['dry-drain', 0.8, true],
    stump: ['stump', 0.85, true],
  };

  /** how far right of a bench model's centre its planter tree stands: past the seat's end (the model is ~0.9 wide) */
  static readonly PLANTER_BESIDE = 0.64;

  private propModel(prop: string, x: number, y: number, z: number): boolean {
    if (!this.batch) return false;
    if (prop === 'bandstand') {
      // one structure over its 2×2 footprint, from its first tile only (the others draw nothing)
      const first = PARK_LAYOUT.props.find((p) => p.prop === 'bandstand')!.at;
      if (Math.floor(x) !== first[0] || Math.floor(z) !== first[1]) return !!MODELS?.has('bandstand');
      return this.batch.add('bandstand', x + 0.5, y, z + 0.5, 0, 0.58, 0.58, 0.58, this.neglected);
    }
    const [name, scale, turn] = ChunkRenderer.PROP_MODELS[prop] ?? ChunkRenderer.PROP_MODELS.stump;
    const rot = turn ? Math.floor(dhash(Math.floor(x), Math.floor(z), 211) * 4) * (Math.PI / 2) : 0;
    if (prop === 'bench') {
      // E23.2.3: an old park bench is broken until mended: weathered, sagging and sunk a little into the ground
      const bx = Math.floor(x);
      const bz = Math.floor(z);
      if (this.brokenBench(bx, bz)) return this.batch.add(name, x, y - 0.05, z, rot + 0.12, scale, scale * 0.82, scale, true);
    }
    return this.batch.add(name, x, y, z, rot, scale, scale, scale, this.neglected);
  }

  /** A canal dropping a level over this edge: its water falls over it instead of a wall. */
  private weir = (x: number, z: number, dx: number, dz: number): boolean =>
    this.sim.grid.peek(GROUND, x, z)?.feature === 'water' && this.sim.grid.peek(GROUND, x + dx, z + dz)?.feature === 'water';

  /**
   * E25 (#626): the places the level II moves reach, dressed so they read as places, not plinths. The ruins' roofs
   * are old buildings: their walls (the retaining wall's stone and courses, drawn by terrace) get a dark doorway and
   * bricked-up windows, the top edge is broken stubs of wall, and a few stones lie fallen on top. The boathouse is
   * planked, with eaves boards and a wide boat door to the water. The sandbar is wet sand with round stones, shells, a bleached log and tufts of grass.
   */
  private moveLand(b: Sink, t: TileData, h: number, th: number) {
    const ml = moveLandAt(t.x, t.z);
    if (!ml) return;
    const P = PALETTE.props;
    const r = (k: number) => dhash(t.x, t.z, 240 + k);
    const x = t.x + 0.5;
    const z = t.z + 0.5;
    if (ml.ground === 'sand') {
      // keep the tiles a trip lands on clear, and the stash's own tile
      if (t.prop || MOVE_TRIPS.some((m) => m.to[0] === t.x && m.to[1] === t.z)) return;
      const y = th + 0.086; // the painted sand's top
      // each tile keeps its rocks to one corner and its log to the other, so they never run through each other
      const flip = r(0) < 0.5 ? 1 : -1;
      if (r(1) < 0.6) {
        // a few round stones in a huddle, like the pebbles by the jetty steps
        const cx = x - 0.2 * flip + (r(2) - 0.5) * 0.12;
        const cz = z - 0.2 + (r(3) - 0.5) * 0.12;
        const n = 1 + Math.floor(r(4) * 3);
        for (let i = 0; i < n; i++) {
          const sz = 0.17 + r(5 + i) * 0.1;
          b.add('sphere', i % 2 ? PALETTE.stone.grey : PALETTE.stone.pebble, [cx + (i - 1) * 0.13, y + sz * 0.3, cz + ((i * 7) % 3 - 1) * 0.07], [sz, sz * 0.75, sz * 0.9]);
        }
      }
      if (r(10) < 0.4) {
        // a bleached log: a row of rounded pieces, thicker at its root end, with a stub of branch
        const along = r(11) < 0.5;
        const len = 0.55 + r(12) * 0.25;
        const lx = x + 0.18 * flip;
        const lz = z + 0.2;
        // pieces close enough to run together into one smooth trunk
        const n = 10;
        for (let i = 0; i < n; i++) {
          const k = i / (n - 1) - 0.5;
          const d = 0.14 - i * 0.005;
          const piece = (len / (n - 1)) * 2.2;
          b.add('sphere', i === 0 ? P.driftwoodEnd : P.driftwood, [lx + (along ? k * len : 0), y + d * 0.4, lz + (along ? 0 : k * len)], [along ? piece : d, d * 0.8, along ? d : piece]);
        }
        b.add('sphere', P.driftwood, [lx + (along ? len * 0.15 : 0.08), y + 0.06, lz + (along ? 0.08 : len * 0.15)], [0.05, 0.05, 0.05]);
      }
      for (let i = 0; i < 3; i++) if (r(20 + i) < 0.5) b.add('sphere', P.shells[i % P.shells.length], [x + (r(23 + i) - 0.5) * 0.8, y + 0.02, z + (r(26 + i) - 0.5) * 0.8], [0.09, 0.045, 0.07]);
      if (r(30) < 0.4) {
        // a little tuft of dune grass
        const gx = x + (r(31) - 0.5) * 0.5;
        const gz = z + 0.25 * -flip;
        for (let i = 0; i < 4; i++) b.add('cone', i % 2 ? P.tuftGreen : P.dryGrass, [gx + (i - 1.5) * 0.04, y + 0.07, gz + ((i * 5) % 3 - 1) * 0.035], [0.035, 0.14 + (i % 3) * 0.03, 0.035]);
      }
      return;
    }
    if (ml.ground !== 'roof') return;
    const W = LOOK.wall; // the retaining wall terrace draws
    const boathouse = ml.id === 'boathouseRoof';
    const top = th + 0.08;
    // the middle cell of each side gets the door (the side to the water for the boathouse, else the south side)
    const mid = (a: number, w: number, c: number) => c === a + Math.floor(w / 2);
    const water = (dx: number, dz: number) => this.sim.grid.peek(GROUND, t.x + dx, t.z + dz)?.feature === 'water';
    const doorSide = (dx: number, dz: number) => (boathouse ? water(dx, dz) || (dz === 1 && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => this.waterBeside(ml, a, c))) : dz === 1);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const low = wallDrop(t.x, t.z, dx, dz);
      if (low === undefined) continue;
      const ground = h + levelY(low);
      const H = top - ground;
      const fx = x + dx * (0.5 + W.thick / 2 + 0.004);
      const fz = z + dz * (0.5 + W.thick / 2 + 0.004);
      const across = (w: number): [number, number, number] => [dx ? 0.02 : w, 0, dz ? 0.02 : w];
      const isMid = dx ? mid(ml.z, ml.d, t.z) : mid(ml.x, ml.w, t.x);
      if (isMid && doorSide(dx, dz) && H > 0.9) {
        // a doorway (the boathouse's is a wide boat door), dark inside, a stone frame and lintel
        const dw = boathouse ? 0.86 : 0.5;
        const dh = Math.min(H - 0.25, boathouse ? 1.0 : 0.9);
        const [sx, , sz] = across(dw);
        b.add('box', P.doorwayDark, [fx, ground + dh / 2, fz], [sx, dh, sz]);
        const frame = boathouse ? PALETTE.wood.deep : PALETTE.stone.shadow;
        const [lx, , lz] = across(dw + 0.16);
        b.add('box', frame, [fx + dx * 0.01, ground + dh + 0.05, fz + dz * 0.01], [lx, 0.1, lz]);
        for (const k of [-1, 1]) b.add('box', frame, [fx + dx * 0.01 + (dx ? 0 : k * (dw / 2 + 0.04)), ground + dh / 2, fz + dz * 0.01 + (dz ? 0 : k * (dw / 2 + 0.04))], [dx ? 0.04 : 0.08, dh, dz ? 0.04 : 0.08]);
      } else if (H > 1 && r(30 + dx + dz * 2) < (boathouse ? 0.35 : 0.7)) {
        // a window, bricked up long ago, with a stone sill and lintel
        const ww = 0.34;
        const wh = 0.4;
        const wy = top - 0.42 - wh / 2;
        const [sx, , sz] = across(ww);
        b.add('box', P.brickedUp, [fx, wy, fz], [sx, wh, sz]);
        const [lx, , lz] = across(ww + 0.12);
        for (const k of [-1, 1]) b.add('box', PALETTE.stone.shadow, [fx + dx * 0.01, wy + k * (wh / 2 + 0.03), fz + dz * 0.01], [lx, 0.06, lz]);
      }
      if (boathouse) {
        // timber cladding under the eaves, and eaves boards along the top of the wall
        b.add('box', PALETTE.wood.dark, [x + dx * (0.5 + W.thick / 2 + W.copingLip + 0.02), top - 0.04, z + dz * (0.5 + W.thick / 2 + W.copingLip + 0.02)], [dx ? 0.04 : 1, 0.12, dz ? 0.04 : 1]);
        b.add('box', PALETTE.wood.mid, [x + dx * (0.5 + W.thick / 2 + 0.01), top - 0.3, z + dz * (0.5 + W.thick / 2 + 0.01)], [dx ? 0.02 : 1, 0.34, dz ? 0.02 : 1]);
        continue;
      }
      // the broken top of the old wall: a stub or two of masonry along the edge, with gaps between
      for (let i = 0; i < 2; i++) {
        if (r(40 + i * 3 + dx + dz * 5) < 0.45) continue;
        const along = (r(50 + i + dx * 2 + dz * 3) - 0.5) * 0.7;
        const sh = 0.12 + r(60 + i + dx + dz * 2) * 0.38;
        const len = 0.2 + r(70 + i + dx * 3 + dz) * 0.25;
        const cx = x + dx * (0.5 - W.thick / 2) + (dx ? 0 : along);
        const cz = z + dz * (0.5 - W.thick / 2) + (dz ? 0 : along);
        b.add('box', PALETTE.retaining.stone[1], [cx, top + 0.05 + sh / 2, cz], [dx ? W.thick : len, sh, dz ? W.thick : len]);
        b.add('box', PALETTE.retaining.coping[1], [cx, top + 0.06 + sh, cz], [dx ? W.thick + 0.04 : len + 0.04, 0.04, dz ? W.thick + 0.04 : len + 0.04]);
      }
    }
    if (boathouse) {
      // the roof is planked: boards across it, a little proud of the ground
      const surf = th + 0.08;
      for (let i = 0; i < 4; i++) b.add('box', i % 2 ? PALETTE.wood.mid : PALETTE.wood.light, [x - 0.375 + i * 0.25, surf + 0.01, z], [0.23, 0.02, 1]);
      // the ridge beam down the middle row, end to end
      if (t.z === ml.z + Math.floor(ml.d / 2)) b.add('box', PALETTE.wood.deep, [x, surf + 0.07, z], [1, 0.1, 0.12]);
      return;
    }
    // a few stones fallen on top
    if (!t.prop && r(80) < 0.4) b.add('box', PALETTE.retaining.stone[1], [x + (r(81) - 0.5) * 0.5, th + 0.08 + 0.07, z + (r(82) - 0.5) * 0.5], [0.18 + r(83) * 0.12, 0.14, 0.14 + r(84) * 0.1]);
    if (!t.prop && r(85) < 0.3) b.add('sphere', PALETTE.stone.grey, [x + (r(86) - 0.5) * 0.6, th + 0.08 + 0.04, z + (r(87) - 0.5) * 0.6], [0.16, 0.09, 0.13]);
  }

  /** Is there water beside this piece of move land on that side (anywhere along it)? */
  private waterBeside(ml: { x: number; z: number; w: number; d: number }, dx: number, dz: number): boolean {
    const cells: [number, number][] = [];
    if (dx) for (let k = 0; k < ml.d; k++) cells.push([dx > 0 ? ml.x + ml.w : ml.x - 1, ml.z + k]);
    else for (let k = 0; k < ml.w; k++) cells.push([ml.x + k, dz > 0 ? ml.z + ml.d : ml.z - 1]);
    return cells.some(([cx, cz]) => this.sim.grid.peek(GROUND, cx, cz)?.feature === 'water');
  }

  /**
   * E21.24: the Old City's terraces. Where a neighbour's edge is lower, an old retaining wall (brick and stone,
   * coping on top) drops to it, with ivy once the ground above is restored. A ramp or stair tile is drawn as
   * steps from its low end to its high end. `h` is the chunk's base height, `th` this tile's.
   */
  private terrace(b: Sink, t: TileData, h: number, th: number) {
    const R = PALETTE.retaining;
    const x = t.x + 0.5;
    const z = t.z + 0.5;
    const alive = t.ground === 'restored' ? 0 : 1;
    if (t.ramp) {
      const hit = rampAt(t.x, t.z);
      if (!hit) return;
      const steps = hit.ramp.kind === 'stair' ? 2 : 3;
      const [fx, fz] = ({ n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] } as const)[hit.ramp.dir];
      const col = t.ground === 'restored' ? PALETTE.paving.slabs[0] : R.stone[1];
      for (let k = 0; k < steps; k++) {
        const lv = hit.ramp.from + ((hit.ramp.to - hit.ramp.from) * (hit.i + (k + 0.5) / steps)) / hit.n;
        const top = h + levelY(lv);
        const low = Math.min(top, h + levelY(Math.min(hit.ramp.from, hit.ramp.to))) - 0.4;
        const off = (k + 0.5) / steps - 0.5;
        const cx = x + fx * off;
        const cz = z + fz * off;
        const len = 1 / steps;
        b.add('box', col, [cx, (top + low) / 2 + 0.08, cz], [fx ? len : 1, top - low, fz ? len : 1]);
        b.add('box', R.coping[alive], [cx, top + 0.085, cz], [fx ? len : 1.02, 0.03, fz ? len : 1.02]);
      }
      return;
    }
    const W = LOOK.wall;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const lowLv = wallDrop(t.x, t.z, dx, dz);
      if (lowLv === undefined) continue;
      const top = th + 0.08;
      const ground = h + levelY(lowLv);
      // #648: the foot goes well under the lower side's water, so its ripples never show a seam along the wall
      const bottom = ground - W.footSink;
      const H = top - bottom;
      const wx = x + dx * 0.5;
      const wz = z + dz * 0.5;
      // a weir: where a canal drops a level, its water falls over the edge
      if (this.weir(t.x, t.z, dx, dz)) {
        b.add('box', PALETTE.aqua.foam, [wx + dx * 0.04, bottom + H / 2, wz + dz * 0.04], [dx ? 0.1 : 1, H, dz ? 0.1 : 1], 0.3);
        b.add('box', PALETTE.ground.seaFoam, [wx + dx * 0.25, bottom + 0.06, wz + dz * 0.25], [dx ? 0.4 : 1, 0.05, dz ? 0.4 : 1]);
        continue;
      }
      // #648: along a run of wall each stone stops flush at the tile edge (no overlaps to notch the coping); where
      // the wall ends or turns a corner it reaches on to close the corner
      const ax = dz ? 1 : 0;
      const az = dx ? 1 : 0;
      const [on0, on1] = wallRuns(t.x, t.z, dx, dz, this.weir);
      const end0 = on0 ? 0 : 1;
      const end1 = on1 ? 0 : 1;
      // stone wall with brick courses, a coping stone on top
      const piece = (col: string, reach: number, y: number, height: number, across: number, out: number) => {
        const len = 1 + reach * (end0 + end1);
        const shift = (reach * (end1 - end0)) / 2;
        b.add('box', col, [wx + ax * shift + dx * out, y, wz + az * shift + dz * out], [dx ? across : len, height, dz ? across : len]);
      };
      piece(R.stone[alive], W.thick / 2, bottom + H / 2, H, W.thick, 0);
      // one colour per course along the whole run, standing proud of the face so its top edge never thins to nothing
      const bricks = PALETTE.bricks;
      const line = dx ? t.x * 2 + dx : t.z * 2 + dz;
      for (let c = 0, y = ground + W.courseFrom; y + W.courseHeight / 2 < top - 0.1; c++, y += W.courseStep)
        piece(bricks[(((line * 7 + c) % bricks.length) + bricks.length) % bricks.length], W.thick / 2 + W.courseProud, y, W.courseHeight, W.thick + W.courseProud, W.courseProud / 2);
      piece(R.coping[alive], W.thick / 2 + W.copingLip, top + 0.02, W.copingHeight, W.thick + W.copingLip * 2, 0);
      // ivy and hanging plants once the ground above is restored
      if (t.ground === 'restored') {
        const n = 2 + (t.variant % 3);
        for (let i = 0; i < n; i++) {
          const along = ((t.variant >> (i * 2)) % 10) / 10 - 0.45;
          const len = 0.3 + ((t.variant >> i) % 5) * 0.12;
          b.add('box', R.vine[i % 2], [wx + dx * 0.07 + (dz ? along : 0), top - len / 2, wz + dz * 0.07 + (dx ? along : 0)], [dx ? 0.04 : 0.14, len, dz ? 0.04 : 0.14]);
        }
      }
    }
  }

  /**
   * E21.2: the Old City's set pieces on their tile. A salvage pile is its material's model in three sizes,
   * shrinking as it empties; a barricade is a heap of rubble across the avenue; the ruined shed is drawn once
   * from its corner tile; a Keeper stands on bare ground (KeeperVisuals draws it). True when handled.
   */
  private oldCityProp(b: Sink, t: TileData, x: number, y: number, z: number): boolean {
    const prop = t.prop!;
    if (prop.startsWith('pile:')) {
      const pile = pileById(prop.slice(5));
      if (!pile) return false;
      const size = SALVAGE.units[pile.size];
      const k = Math.max(0, this.sim.salvage.left(pile.id)) / size;
      // the salvage-* models (#379) are made one tile across; the older scrap and seed props are smaller
      const own = pile.model.startsWith('salvage-');
      const base = own ? (pile.size === 'large' ? 1.05 : pile.size === 'medium' ? 0.85 : 0.65) : pile.size === 'large' ? 1.45 : pile.size === 'medium' ? 1.15 : 0.9;
      const sc = base * (0.45 + 0.55 * k);
      const rot = dhash(t.x, t.z, 213) * Math.PI * 2;
      const model = oldCityModel(pile.model); // the file once it lands, else its stand-in
      if (model && this.batch?.add(model, x, y, z, rot, sc, sc, sc, this.neglected)) return true;
      // E23.8.3.2: steel lies as a crossed stack of rusting I-beams (until E23.10.2's salvage-steel model)
      if (pile.material === 'steel') {
        this.girders(b, t, x, y, z, pile.size === 'large' ? 5 : pile.size === 'medium' ? 4 : 3, 0.55 + 0.45 * k);
        return true;
      }
      // no model (or not loaded yet): a heap in the material's colour
      const hex = MATERIALS[pile.material].colour;
      b.add('sphere', hex, [x, y + 0.12 * sc, z], [0.8 * sc, 0.35 * sc, 0.7 * sc]);
      b.add('box', PALETTE.stone.light, [x + 0.15 * sc, y + 0.2 * sc, z - 0.1 * sc], [0.3 * sc, 0.2 * sc, 0.25 * sc]);
      return true;
    }
    if (prop.startsWith('gate:')) {
      // E21.5: a gate is one model over all its cells (drawn from its first cell), fitted to the gate's length
      // and turned along its long side: the barricade (4 m), the bridges (14 m, along +X) and the skybridge (12 m)
      const sp = setPieceAt(t.x, t.z);
      if (sp?.kind !== 'gate') return true;
      const g = sp.gate;
      const xs = g.cells.map((c) => c[0]);
      const zs = g.cells.map((c) => c[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      if (t.x !== x0 || t.z !== z0) return true;
      const name = GATE_MODELS[g.kind];
      const model = oldCityModel(name);
      const spanX = x1 - x0 + 1;
      const spanZ = z1 - z0 + 1;
      const alongX = spanX >= spanZ;
      const length = GATE_LENGTH[name] ?? 4;
      // a barricade fills the opening across the avenue; a bridge spans the gap along its length
      const across = name === 'barricade' ? Math.max(spanX, spanZ) : alongX ? spanX : spanZ;
      const sc = across / length;
      const cx = (x0 + x1 + 1) / 2;
      const cz = (z0 + z1 + 1) / 2;
      if (!model || !this.batch?.add(model, cx, y, cz, alongX ? 0 : Math.PI / 2, sc, sc, sc, !!model && model === 'barricade' ? true : false))
        for (const [gx, gz] of g.cells) b.add('sphere', PALETTE.stone.dark, [gx + 0.5, y + 0.15, gz + 0.5], [0.95, 0.45, 0.9]);
      return true;
    }
    if (prop.startsWith('keeper:')) return true;
    if (prop.startsWith('ruin:')) {
      this.ruin(b, t, prop, x, y, z);
      return true;
    }
    if (prop.startsWith('lookout:')) {
      // E21.24: a lookout: its model once it lands, else a bench and a brass telescope on a tripod (stand-in)
      const model = oldCityModel('lookout-telescope');
      if (model) return !!this.batch?.add(model, x, y, z, 0, 0.65, 0.65, 0.65);
      if (!this.batch?.add('bench', x, y, z + 0.2, 0, 0.58, 0.58, 0.58)) b.add('box', PALETTE.wood.mid, [x, y + 0.18, z + 0.2], [0.8, 0.05, 0.3]);
      for (const a of [0, 2.1, 4.2]) b.add('cylinder', PALETTE.metal.iron, [x + Math.cos(a) * 0.12, y + 0.25, z - 0.2 + Math.sin(a) * 0.12], [0.03, 0.5, 0.03]);
      b.add('cylinder', PALETTE.trim.gold ?? PALETTE.metal.iron, [x, y + 0.55, z - 0.2], [0.09, 0.42, 0.09]);
      return true;
    }
    if (prop.startsWith('page:')) {
      // E23.9.1: a page of the maker's journal on its post (the post stays once the page is read)
      const rot = dhash(t.x, t.z, 217) * Math.PI * 2;
      const model = oldCityModel('journal-page-post');
      if (model && this.batch?.add(model, x, y, z, rot, 0.7, 0.7, 0.7)) return true;
      b.add('cylinder', PALETTE.wood.mid, [x, y + 0.35, z], [0.06, 0.7, 0.06]);
      b.add('box', PALETTE.stone.light, [x, y + 0.62, z + 0.05], [0.26, 0.32, 0.02]);
      return true;
    }
    if (prop.startsWith('vault:') || prop.startsWith('stash:')) {
      this.moveSpot(b, t, prop, x, y, z);
      return true;
    }
    if (prop === 'shed') {
      const sh = PARK_SET.shed;
      if (t.x !== sh.x || t.z !== sh.z) return true;
      const cx = sh.x + sh.size / 2;
      const cz = sh.z + sh.size / 2;
      const house = this.sim.state.salvage?.house ?? 0;
      const W = sh.size - 0.3;
      const wall = house >= 1 ? PALETTE.wood.mid : PALETTE.wood.deep;
      // four walls (the front one broken until the shed is patched), a sagging roof
      b.add('box', wall, [cx, y + 0.5, cz - W / 2], [W, 1, 0.12]);
      b.add('box', wall, [cx - W / 2, y + 0.5, cz], [0.12, 1, W]);
      b.add('box', wall, [cx + W / 2, y + (house >= 1 ? 0.5 : 0.3), cz], [0.12, house >= 1 ? 1 : 0.6, W]);
      b.add('box', wall, [cx - 0.5, y + 0.5, cz + W / 2], [W - 1.1, 1, 0.12]);
      b.add('box', house >= 1 ? PALETTE.wood.dark : PALETTE.metal.iron, [cx, y + 1.08, cz], [W + 0.2, 0.08, W + 0.2]);
      if (house < 1) b.add('box', PALETTE.wood.dark, [cx + 0.6, y + 0.12, cz + 0.4], [0.9, 0.06, 0.2]);
      return true;
    }
    return false;
  }

  /**
   * E25 (#626): a sealed vault and a stash. A vault is a squat stone strongroom with an iron door on the side that
   * faces open ground: shut, a wheel and rivets; forced, the door stands open against the wall and the inside is dark.
   * A stash is a small wooden box with iron bands: shut, a gold catch glints; opened, its lid leans back, empty.
   */
  private moveSpot(b: Sink, t: TileData, prop: string, x: number, y: number, z: number) {
    const id = prop.slice(6);
    const open = !!this.sim.state.salvage?.caches.includes(id);
    // the side to face: the first neighbour Bloombot could stand on
    const sides: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    const [dx, dz] = sides.find(([a, c]) => {
      const n = this.sim.grid.peek(GROUND, t.x + a, t.z + c);
      return !!n && !n.blocked && n.level === t.level;
    }) ?? [0, 1];
    const along = (k: number) => [dz ? k : 0, dx ? k : 0] as const; // across the door's face
    if (prop.startsWith('vault:')) {
      // taller than Bloombot, so it shows over its head from the follow camera
      const W = 0.98;
      const H = 1.4;
      b.add('box', PALETTE.stone.dark, [x, y + H / 2, z], [W, H, W]);
      b.add('box', PALETTE.stone.shadow, [x, y + H + 0.05, z], [W + 0.08, 0.1, W + 0.08]);
      for (let c = 0; c < 5; c++) b.add('box', PALETTE.stone.grey, [x, y + 0.16 + c * 0.26, z], [W + 0.01, 0.03, W + 0.01]);
      const fx = x + dx * (W / 2 + 0.01);
      const fz = z + dz * (W / 2 + 0.01);
      const dw = 0.62;
      const dh = 1.0;
      // a stone frame round the door, a lintel over it
      const [lx, lz] = along(dw / 2 + 0.06);
      for (const k of [-1, 1]) b.add('box', PALETTE.stone.shadow, [fx + dx * 0.02 + lx * k, y + dh / 2 + 0.04, fz + dz * 0.02 + lz * k], [dx ? 0.07 : 0.1, dh + 0.08, dz ? 0.07 : 0.1]);
      b.add('box', PALETTE.stone.shadow, [fx + dx * 0.02, y + dh + 0.12, fz + dz * 0.02], [dx ? 0.08 : dw + 0.3, 0.12, dz ? 0.08 : dw + 0.3]);
      if (!open) {
        b.add('box', PALETTE.metal.iron, [fx, y + dh / 2 + 0.04, fz], [dx ? 0.05 : dw, dh, dz ? 0.05 : dw]);
        b.add('box', PALETTE.metal.rust, [fx + dx * 0.01, y + dh / 2 + 0.04, fz + dz * 0.01], [dx ? 0.04 : dw * 0.84, dh * 0.88, dz ? 0.04 : dw * 0.84]);
        // the wheel that once turned the bolts, and its spokes
        b.add('sphere', PALETTE.trim.brass, [fx + dx * 0.05, y + 0.56, fz + dz * 0.05], [dx ? 0.04 : 0.3, 0.3, dz ? 0.04 : 0.3]);
        b.add('box', PALETTE.trim.bronzeAged, [fx + dx * 0.07, y + 0.56, fz + dz * 0.07], [dx ? 0.03 : 0.32, 0.04, dz ? 0.03 : 0.32]);
        b.add('box', PALETTE.trim.bronzeAged, [fx + dx * 0.07, y + 0.56, fz + dz * 0.07], [dx ? 0.03 : 0.04, 0.32, dz ? 0.03 : 0.04]);
        for (const k of [-1, 1])
          for (const h of [0.16, 0.95]) {
            const [ax, az] = along(k * dw * 0.4);
            b.add('sphere', PALETTE.metal.steel, [fx + dx * 0.03 + ax, y + h, fz + dz * 0.03 + az], [0.04, 0.04, 0.04]);
          }
      } else {
        b.add('box', PALETTE.props.vaultInside, [fx, y + dh / 2 + 0.04, fz], [dx ? 0.03 : dw, dh, dz ? 0.03 : dw]);
        const [ax, az] = along(dw / 2 + 0.02);
        b.add('box', PALETTE.metal.iron, [fx + dx * (dw / 2) + ax, y + dh / 2 + 0.04, fz + dz * (dw / 2) + az], [dx ? dw : 0.05, dh, dz ? dw : 0.05]);
      }
      return;
    }
    // a stash
    const L = 0.5;
    const D = 0.34;
    const bh = 0.24;
    const sx = dx ? D : L;
    const sz = dz ? D : L;
    b.add('box', PALETTE.wood.crate, [x, y + bh / 2, z], [sx, bh, sz]);
    for (const k of [-1, 1]) {
      const [ax, az] = along(k * L * 0.3);
      b.add('box', PALETTE.props.stashBand, [x + ax, y + bh / 2, z + az], [dx ? D + 0.02 : 0.04, bh + 0.01, dz ? D + 0.02 : 0.04]);
    }
    if (!open) {
      b.add('box', PALETTE.wood.dark, [x, y + bh + 0.035, z], [sx + 0.03, 0.07, sz + 0.03]);
      b.add('box', PALETTE.trim.gold, [x + dx * (D / 2 + 0.02), y + bh, z + dz * (D / 2 + 0.02)], [dx ? 0.02 : 0.07, 0.08, dz ? 0.02 : 0.07]);
    } else {
      b.add('box', PALETTE.props.vaultInside, [x, y + bh - 0.01, z], [sx - 0.06, 0.02, sz - 0.06]);
      b.add('box', PALETTE.wood.dark, [x - dx * (D / 2 + 0.03), y + bh + D / 2, z - dz * (D / 2 + 0.03)], [dx ? 0.05 : L + 0.03, D, dz ? 0.05 : L + 0.03]);
    }
  }

  /**
   * E23.8.3.2: one I-beam (a web between two flanges), along x or z. The Sink draws unturned shapes, so a beam
   * lies along an axis; a stack crosses its layers like a crib.
   */
  private ibeam(b: Sink, hex: string, x: number, y: number, z: number, len: number, alongX: boolean, d = 0.16) {
    const L = (l: number, w: number): [number, number, number] => (alongX ? [l, 0, w] : [w, 0, l]);
    const [fx, , fz] = L(len, d);
    const [wx, , wz] = L(len, d * 0.22);
    b.add('box', hex, [x, y + 0.015, z], [fx, 0.03, fz]);
    b.add('box', hex, [x, y + d / 2, z], [wx, d - 0.04, wz]);
    b.add('box', hex, [x, y + d - 0.015, z], [fx, 0.03, fz]);
  }

  /** E23.8.3.2: a steel pile: layers of I-beams, each crossing the one below, shrinking as it is salvaged. */
  private girders(b: Sink, t: TileData, x: number, y: number, z: number, layers: number, k: number) {
    const tones = [PALETTE.metal.steel, PALETTE.metal.iron, PALETTE.metal.slate, PALETTE.metal.steel, PALETTE.props.girderRust];
    const first = dhash(t.x, t.z, 231) < 0.5;
    const n = Math.max(1, Math.round(layers * k));
    const d = 0.18;
    for (let i = 0; i < n; i++) {
      const alongX = (i % 2 === 0) === first;
      const len = 0.98 - i * 0.07;
      const per = i === n - 1 && n > 1 ? 2 : 3;
      for (let j = 0; j < per; j++) {
        const off = (j - (per - 1) / 2) * 0.29 + (dhash(t.x + i, t.z + j, 233) - 0.5) * 0.06;
        const slide = (dhash(t.x + j, t.z + i, 235) - 0.5) * 0.14;
        const tone = tones[Math.floor(dhash(t.x + i * 3, t.z + j * 5, 237) * tones.length)];
        this.ibeam(b, tone, x + (alongX ? slide : off), y + i * d, z + (alongX ? off : slide), len, alongX, d);
      }
    }
    // one beam slid off the stack, its end on the ground
    if (n >= 2) {
      const alongX = !first;
      this.ibeam(b, PALETTE.props.girderRust, x + (alongX ? 0.1 : 0.42), y, z + (alongX ? 0.42 : 0.1), 0.6, alongX, 0.12);
    }
    // rust run-off round its foot
    b.add('sphere', PALETTE.props.rustStain, [x, y + 0.004, z], [1.05, 0.01, 0.95]);
  }

  /**
   * E23.8.3.2: the industrial ruins round a steel field (core/Mainland chunkRuins): a rusted steel frame still
   * standing, a gantry whose girder snapped and fell (drawn from its first leg; you walk under it) and rust stains.
   */
  private ruin(b: Sink, t: TileData, prop: string, x: number, y: number, z: number) {
    const [, kind, turnS, part, spanS] = prop.split(':');
    const alongX = turnS === '0';
    const rust = PALETTE.metal.iron;
    const deep = PALETTE.props.girderRust;
    const at = (along: number, across: number): [number, number] => (alongX ? [x + along, z + across] : [x + across, z + along]);
    if (kind === 'stain') {
      if (t.ground === 'restored') return;
      const j = (s: number) => (dhash(t.x, t.z, s) - 0.5) * 0.4;
      b.add('sphere', PALETTE.props.rustStain, [x + j(241), y + 0.004, z + j(242)], [0.7 + j(243), 0.012, 0.55 + j(244)]);
      b.add('sphere', PALETTE.ground.rustStreak, [x + j(245), y + 0.008, z + j(246)], [0.3, 0.012, 0.22]);
      return;
    }
    // stained ground under every piece
    b.add('sphere', PALETTE.props.rustStain, [x, y + 0.004, z], [1.0, 0.01, 0.9]);
    if (kind === 'frame') {
      // a portal frame: two posts, a cross-girder, one brace rung half gone; it leans a little (one post shorter)
      const H = 1.5 + dhash(t.x, t.z, 251) * 0.5;
      const lean = 0.18;
      for (const [s, h] of [[-0.38, H], [0.38, H - lean]] as const) {
        const [px, pz] = at(s, 0);
        b.add('box', rust, [px, y + h / 2, pz], [0.13, h, 0.13]);
        b.add('box', deep, [px, y + 0.04, pz], [0.26, 0.08, 0.26]); // its base plate
      }
      const [tx, tz] = at(0, 0);
      this.ibeam(b, deep, tx, y + H - lean - 0.02, tz, 0.98, alongX, 0.18);
      const [rx, rz] = at(-0.16, 0);
      b.add('box', rust, [rx, y + H * 0.45, rz], alongX ? [0.44, 0.07, 0.07] : [0.07, 0.07, 0.44]);
      // a torn sheet of cladding still bolted on
      if (dhash(t.x, t.z, 253) < 0.6) {
        const [cx, cz] = at(0.15, 0.08);
        b.add('box', PALETTE.metal.grey, [cx, y + H * 0.7, cz], alongX ? [0.42, 0.5, 0.02] : [0.02, 0.5, 0.42]);
      }
      return;
    }
    if (kind === 'gantry') {
      if (part !== 'a') return; // drawn whole from its first leg
      const span = Number(spanS) || 3;
      const H = 2.3;
      // a leg pair at each end, tied by a cross-beam
      for (const s of [0, span]) {
        for (const w of [-0.34, 0.34]) {
          const [px, pz] = at(s, w);
          b.add('box', rust, [px, y + H / 2, pz], [0.14, H, 0.14]);
        }
        const [cx, cz] = at(s, 0);
        b.add('box', deep, [cx, y + H - 0.08, cz], alongX ? [0.18, 0.16, 0.86] : [0.86, 0.16, 0.18]);
        b.add('box', rust, [cx, y + H * 0.35, cz], alongX ? [0.08, 0.08, 0.7] : [0.7, 0.08, 0.08]);
      }
      // the runway girders: one still spans most of the way, the other snapped and fell
      const keep = span * 0.62;
      const [gx, gz] = at(keep / 2, -0.34);
      this.ibeam(b, deep, gx, y + H, gz, keep + 0.2, alongX, 0.22);
      const [sx, sz] = at(span, 0.34);
      this.ibeam(b, deep, sx - (alongX ? 0.3 : 0), y + H, sz - (alongX ? 0 : 0.3), 0.7, alongX, 0.22);
      // its broken end hangs from the far stub; the rest lies on the ground below
      const [hx, hz] = at(span - 0.68, 0.34);
      b.add('box', rust, [hx, y + H - 0.45, hz], [0.08, 0.9, 0.08]);
      const [fx, fz] = at(span * 0.45, 0.42);
      this.ibeam(b, PALETTE.metal.rust, fx, y, fz, span * 0.8, alongX, 0.2);
      // the hoist's hook block, still on the standing girder
      const [kx, kz] = at(keep * 0.5, -0.34);
      b.add('box', PALETTE.metal.dark, [kx, y + H - 0.25, kz], [0.03, 0.4, 0.03]);
      b.add('box', PALETTE.metal.iron, [kx, y + H - 0.5, kz], [0.16, 0.14, 0.12]);
    }
  }

  /**
   * #596: a small mesh for each chunk material made only when the world needs it (an area's towers once its fog
   * thins, a pool once it holds water, the growth transitions on a first pulse), in the same vertex layout, so the
   * loading screen can compile their shaders before play.
   */
  warmupSamples(): WarmupSample[] {
    const b = new MeshBuilder();
    b.add('box', PALETTE.stone.white, [0, 0, 0], 0.05); // the colour doesn't matter: only the layout does
    const tb = new TrMeshBuilder();
    tb.add('box', PALETTE.stone.white, [0, 0, 0], 0.05);
    const plain = b.build(this.device)!;
    return [
      { mesh: plain, material: towerMaterial(), own: true },
      { mesh: plain, material: poolMaterial(this.device) },
      { mesh: tb.build(this.device)!, material: transitionMaterial(), own: true },
    ];
  }

  private setMesh(holder: pc.Entity | undefined, name: string, mesh: pc.Mesh | undefined, material: pc.Material, shadows: boolean): pc.Entity | undefined {
    holder?.destroy();
    if (!mesh) return undefined;
    const e = new pc.Entity(name);
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: shadows, receiveShadows: true });
    this.root.addChild(e);
    return e;
  }

  // ───────────── ground mesh ─────────────

  /**
   * City 15.4: a chunk's ground is built as a resumable job, a tile at a time. `update` runs it for a few
   * milliseconds a frame (one chunk at near zoom can take far longer than a frame when its trees and props are
   * new), and abandons it if the camera has left and the chunk was dropped. Nothing is shown until the last step,
   * which swaps all of the chunk's meshes in at once. One job at a time: the build's working state lives on `this`.
   */
  private job?: { v: ChunkView; steps: Generator<void>; solids?: SolidCollector };

  /**
   * E23.12.3 (#530): every built ground chunk's solid boxes, as its build drew them (core/Solids), for the CPU line
   * of sight where the GPU sight pick can't run.
   */
  readonly solids = new SolidIndex();

  /** Runs the job until it finishes (true) or the frame's budget is spent (false). Always makes some progress. */
  private runJob(over: () => boolean): boolean {
    const job = this.job!;
    for (;;) {
      // only this chunk's own drawing reports solids (nothing else drawn between its steps)
      SOLID_SINK.current = job.solids;
      let done: boolean | undefined;
      try {
        done = job.steps.next().done;
      } finally {
        SOLID_SINK.current = undefined;
      }
      if (done) {
        this.job = undefined;
        return true;
      }
      if (over()) return false;
    }
  }

  private *buildGround(v: ChunkView): Generator<void> {
    v.dirty = false;
    const s = this.sim;
    const c = s.grid.chunkAt(GROUND, v.cx, v.cz);
    if (!c) return;
    const b = new MeshBuilder();
    const fb = new FoliageBuilder();
    const towers: Tower[] = [];
    this.fb = fb;
    this.chunkFb = fb;
    const tr = this.transitions;
    const tB = tr ? chunkBuilders() : undefined;
    let trEnd = 0;
    let trLive = 0;
    const area = s.areas.map.areaOfChunk(v.cx, v.cz);
    this.areaType = s.areas.info(area).type;
    const gen = s.grid.layer(GROUND)?.gen ?? 1;
    this.roads = roadPlanFor(s.grid.seed, gen);
    const fog = s.areas.fog(area);
    v.sunk = fog === 'hidden';
    const city = s.grid.layer(GROUND)!.height;
    const h = city - (v.sunk ? SINK : 0);
    // E23.12.3: what this build draws solid is recorded as it goes (the job sets it as the sink for each step)
    const solids = new SolidCollector(h + 0.08);
    if (this.job?.v === v) this.job.solids = solids;
    SOLID_SINK.current = solids;
    v.far = dist(v, this.lastFocus) / CHUNK > this.farFrom;
    // Props in the park follow its stage; elsewhere they're broken until their area clears.
    this.level = area === 'park' ? Math.max(0, this.parkStage) : fog === 'cleared' ? 4 : 0;
    this.inPark = area === 'park';
    this.fog = fog;
    // Phase 5 E16: one obstacle per cleared chunk outside the park becomes a small local landmark (seeded).
    this.localMark = undefined;
    if (this.level >= 4 && !this.inPark) {
      let best = 2;
      for (const t of c.tiles)
        if (t && t.blocked && t.feature !== 'building' && t.prop) {
          const k = hash01(t.x, t.z, 71);
          if (k < best) [best, this.localMark] = [k, t.id];
        }
    }
    v.band = this.band;
    this.batch = MODELS && fog !== 'hidden' ? new ModelBatch(MODELS, !!v.far) : undefined;
    const tierK = this.detail === 'low' ? 0.4 : this.detail === 'medium' ? 0.7 : 1;
    const grid = s.grid;
    const map = s.areas.map;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.sink = b;
    this.ctx = {
      get b() {
        return self.solidSink();
      },
      // #687: while a tile is dressed, its scattered pieces keep their footprint on its drawn top
      get fb() {
        return self.fitNow ? self.scatter : self.fb;
      },
      fit: (x, z, r) => self.spot(x, z, r),
      // hidden (deep fog) chunks keep only the cheap shapes: nothing fine shows through the fog
      dens: fog === 'hidden' ? 0 : tierK * (this.band >= 2 ? 1 : 0.6),
      lod: v.far || fog === 'hidden' ? 0 : this.band >= 2 ? 2 : 1,
      area,
      areaType: this.areaType,
      // a getter: area-wave edges redraw the old dressing with the level overridden (host.withLevel)
      get level() {
        return self.level;
      },
      peek: (x, z) => grid.peek(GROUND, x, z),
      areaAt: (x, z) => map.areaOfCell(x, z),
      slab: (hex, p, sc) => self.slab(self.sink, hex, p, sc),
      model: (name, x, y, z, rot, sx, sy, sz) => !!self.batch?.add(name, x, y, z, rot, sx, sy, sz),
      bloom: (t) => s.water.bloomShown(t), // E23.4.4: the lawn's colour fades with low water too
    };
    // E19.1.5: this chunk's plots and their looks (decided before the tiles, which stay flat under a chosen plot)
    this.plotCells.clear();
    this.chunkPlots = [];
    if (this.plots && fog !== 'hidden')
      for (const p of plotsInChunk(s.grid.seed, v.cx, v.cz, gen)) {
        const look = this.plots.look(p);
        if (look === undefined) continue;
        this.chunkPlots.push({ p, look, growth: look ? (this.plots.growth?.(p) ?? 1) : 1 });
        if (look) for (let j = 0; j < p.size; j++) for (let i = 0; i < p.size; i++) this.plotCells.add(`${p.x + i},${p.z + j}`);
      }
    const pool: PoolGeo = { pos: [], col: [], idx: [] };
    const gtex = GROUND_TEXTURES.map(emptyGroundTexGeo);
    for (const t of c.tiles) {
      if (!t) continue;
      // Hidden ground is grey; fogged ground is greyed unless restored.
      // Look 6.18: while an area-clear wave rolls, ground it hasn't reached yet keeps its fogged look.
      const ahead = fog === 'cleared' && tr?.waveAhead(area, t.x, t.z);
      b.grey = fog === 'hidden' ? 0.75 : (fog === 'cleared' && !ahead) || t.ground === 'restored' ? 0 : 0.35;
      // #626: the sea counts as cleared, but the sandbar out in it is dead ground like the beach it lies off
      if (fog === 'cleared' && t.ground !== 'restored' && moveLandAt(t.x, t.z)?.ground === 'sand') b.grey = 0.35;
      fb.grey = b.grey;
      // E21.24: an Old City tile stands at its terrace's height; cliff faces drop to lower neighbours
      const th = t.level !== undefined ? h + levelY(t.level) : h;
      if (t.level !== undefined) this.terrace(b, t, h, th);
      if (!v.far) this.moveLand(b, t, h, th);
      if (t.ramp) {
        yield;
        continue;
      }
      if (tr && tB) {
        const end = tr.buildTile(this.host, t, th, !!v.far, { b, fb, sb: tB.sb, tb: tB.tb }, area);
        if (end > 0) {
          trEnd = Math.max(trEnd, end);
          trLive++;
        }
      } else if (v.far) this.farTile(b, t, th);
      else this.tile(b, t, th);
      // Look 3.10: railings, vines, banners and clutter on area boundaries (near chunks; with transitions on too).
      // Look 3.8 (#135): while an area wave rolls over the edge, the new dressing grows in through the transition.
      if (!v.far) {
        const end = tr && tB ? tr.edgeTile(this.host, area, t, th, tB.tb, fb, b.grey) : 0;
        if (end > 0) {
          trEnd = Math.max(trEnd, end);
          trLive++;
        } else {
          this.sink = b;
          areaEdges(this.ctx, t, th + 0.08);
        }
      }
      if (!v.far && fog !== 'hidden') this.pathCorners(b, t, th, gtex);
      // E23.13: ground poking out into water is rounded off (its slab, in `slabInto`): the water fills the corner
      const cut = v.far ? undefined : this.landCuts(t);
      if (cut) this.cutWater(b, t, th, cut, pool, gtex);
      if (!v.far && this.isWater(t)) {
        this.poolBanks(b, t, th, gtex);
        // a natural pond's water (the Cistern's) shows whenever it holds any: its level draws the bared bed on top
        if ((t.ground === 'restored' || pondCell(t.x, t.z)) && fog !== 'hidden') this.poolSurface(pool, t, th);
        // a dead pond's bed: dried, cracked silt painted across the whole pond (no tile grid)
        if (this.siltBed(t)) {
          const k = Math.round(255 * (1 - 0.3 * b.grey));
          addGroundQuad(gtex[GROUND_TEXTURES.indexOf('silt-bed')], 'silt-bed', t.x, t.z, th + 0.08 - WATER.drop + 0.002, [k, k, k]);
        }
      }
      // painted ground over each dead Old City tile's slab (sand on the beach, dry earth elsewhere)
      // (not the jetty: its tiles are paving underneath, but its wooden deck is the model's)
      const gt = !v.far && t.level !== undefined && !t.occupantId && t.ground === 'polluted' && !this.overWater(t) ? this.paintedGround(t) : undefined;
      if (gt) {
        const k = Math.round(255 * (1 - 0.3 * b.grey));
        const cut = this.landCuts(t);
        if (this.raisedPaving(t)) this.pavedTop(b, t, th, gtex, k);
        else if (cut) addGroundFan(gtex[GROUND_TEXTURES.indexOf(gt)], gt, [t.x + 0.5, t.z + 0.5], this.cutRing(t, cut), th + 0.086, paintTint(t, k));
        else addGroundQuad(gtex[GROUND_TEXTURES.indexOf(gt)], gt, t.x, t.z, th + 0.086, paintTint(t, k));
      }
      // E23.8.3.2: a rust stain in the industrial ruins, laid over the ground (and its pavers, when they are raised)
      if (!v.far && !t.blocked && t.prop?.startsWith('ruin:stain')) {
        this.sink = b;
        this.ruin(b, t, t.prop, t.x + 0.5, th + 0.086 + (gt && this.raisedPaving(t) ? PAVING_RAISE.lift : 0), t.z + 0.5);
      }
      yield; // a tile done: `update` decides whether this frame has time for the next
    }
    // From here to the end is one step: buildings, then every mesh of the chunk swaps in together.
    v.water = this.setMesh(v.water, `water-${v.key}`, this.poolMesh(pool), poolMaterial(this.device), false);
    v.gtex = GROUND_TEXTURES.map((name, i) => this.setMesh(v.gtex?.[i], `ground-${name}-${v.key}`, groundTexMesh(this.device, gtex[i]), groundTexMaterial(this.device, name), false));
    if (this.inPark && !v.far) {
      b.grey = fb.grey = 0;
      for (const p of PARK_LAYOUT.pergolas) this.pergola(b, fb, p, h + 0.08);
    }
    // Buildings (generation 2): grey and shuttered in the fog, white with roof gardens once the area is clear.
    if ((s.grid.layer(GROUND)!.gen ?? 1) >= 2) {
      b.grey = fog === 'hidden' ? 0.75 : fog === 'cleared' ? 0 : 0.45;
      for (const p of buildingPlots(s.grid.seed, v.cx, v.cz, s.grid.layer(GROUND)!.gen ?? 1)) {
        // An entry fix may have opened one of its tiles: then it's rubble, not a building.
        const whole = s.grid.peek(GROUND, p.x, p.z)?.feature === 'building' && s.grid.peek(GROUND, p.x + p.w - 1, p.z + p.d - 1)?.feature === 'building';
        if (!whole) continue;
        const bh = h + s.grid.groundOffset(GROUND, p.x, p.z); // E21.24: on its terrace
        // E21.22: in the Old City every near building can fade (one standing between the camera and bloombot)
        if ((p.storeys >= 6 || s.grid.terraced(GROUND)) && !v.far && fog !== 'hidden') towers.push(this.tower(p, bh, fog === 'cleared', b.grey));
        else this.building(b, p, bh, fog === 'cleared', v.far);
      }
    }
    // E19.1.5: plots, in the chunk's own meshes and model batch (no extra draw calls)
    if (this.chunkPlots.length) {
      b.grey = fb.grey = 0;
      const host = {
        add: (type: VPrim, hex: string, p: [number, number, number], sc: [number, number, number] | number, glow?: number) => b.add(type, hex, p, sc, glow),
        foliage: (g: TreeGeo, x: number, y: number, z: number, rot: number, scale: number) => fb.add(g, x, y, z, rot, scale),
        model: (name: string, x: number, y: number, z: number, rot: number, sc: number) => !!this.batch?.add(name, x, y, z, rot, sc),
        lod: (v.far ? 0 : this.band >= 2 ? 2 : 1) as Lod,
      };
      for (const { p, look, growth } of this.chunkPlots) drawPlot(host, p, look ?? undefined, h + 0.08 + s.grid.groundOffset(GROUND, p.x, p.z), !!v.far, growth);
    }
    // E19.2: decorations, the same way
    const decor = this.decor && fog !== 'hidden' ? this.decor.inChunk(v.cx, v.cz) : [];
    if (decor.length) {
      b.grey = fb.grey = 0;
      const host = {
        add: (type: VPrim, hex: string, p: [number, number, number], sc: [number, number, number] | number, glow?: number) => b.add(type, hex, p, sc, glow),
        foliage: (g: TreeGeo, x: number, y: number, z: number, rot: number, scale: number) => fb.add(g, x, y, z, rot, scale),
        model: (name: string, x: number, y: number, z: number, rot: number, sc: number) => !!this.batch?.add(name, x, y, z, rot, sc),
        lod: (v.far ? 0 : this.band >= 2 ? 2 : 1) as Lod,
      };
      for (const d of decor) drawDecor(host, d.kind, d.x + 0.5, h + 0.08 + s.grid.groundOffset(GROUND, d.x, d.z), d.z + 0.5, d.rot, !!v.far);
    }
    this.fb = fb;
    this.sink = b;
    for (const t of v.towers ?? []) for (const e of t.entities) e.destroy();
    v.towers = towers.length ? towers : undefined;
    // Look 4.9: retaining-wall facades where the revealed city drops to an unrevealed (sunk) neighbour.
    if (!v.sunk) {
      const alive = fog === 'cleared' || this.inPark;
      b.grey = alive ? 0 : 0.4;
      for (const [dx, dz] of EDGE_DIRS)
        if (s.areas.fog(s.areas.map.areaOfChunk(v.cx + dx, v.cz + dz)) === 'hidden') this.facade(b, v, dx, dz, city, alive, !!v.far);
    }
    // E23.12.3: everything this build drew solid, the facades included, into the per-tile index
    this.solids.setChunk(v.key, solids.boxes);
    v.ground = this.setMesh(v.ground, `chunk-${v.key}`, b.build(this.device), vertexColourMaterial(), !v.far); // far chunks: no shadow pass (invisible at that distance, halves their draw calls)
    v.trees = this.setMesh(v.trees, `trees-${v.key}`, fb.build(this.device), foliageMaterial(), !v.far);
    this.treeTris.set(v.key, fb.tris);
    this.groundTris.set(v.key, b.tris);
    this.setModels(v, h);
    if (tr && tB) {
      // Look 6.12: the living surface casts no shadow (flat slabs), the moving props do.
      v.surface = this.setMesh(v.surface, `surface-${v.key}`, tB.sb.build(this.device), tr.material, false);
      v.trans = this.setMesh(v.trans, `trans-${v.key}`, tB.tb.build(this.device), tr.material, !v.far);
      v.trEnd = trEnd;
      tr.liveByChunk.set(v.key, trLive);
      if (tr.waving(area)) v.waveAt = tr.time;
    }
  }

  /** Look 2.3: the warm stone tone of one restored paving slab (stable per tile). */
  private slabTone(t: TileData): string {
    const s = PALETTE.paving.slabs;
    return s[Math.floor(hash01(t.x, t.z, 41) * s.length) % s.length];
  }

  /**
   * The painted texture a dead Old City tile wears. An obstacle or a salvage pile takes its neighbours' ground, so
   * it stands on the beach or the earth, not on a square of its own.
   */
  private paintedGround(t: TileData): GroundTexName | undefined {
    if (!t.blocked) return groundTexFor(t.feature);
    if (t.feature !== 'obstacle') return undefined;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.sim.grid.peek(t.roofId, t.x + dx, t.z + dz);
      const g = n && !n.blocked && n.level === t.level ? groundTexFor(n.feature) : undefined;
      if (g) return g;
    }
    return undefined;
  }

  /** Far level of detail: one coloured slab per tile, with a bump for full bloom. */
  private farTile(b: Sink, t: TileData, h: number) {
    this.sink = b;
    this.cutNow = undefined; // far off, ground stays square
    const f = t.feature ?? 'lawn';
    const dead = paintedDead(t) ?? DEAD[f] ?? DEAD.lawn;
    const stage = Math.max(1, Math.min(4, this.sim.water.bloomShown(t) || 1)); // E23.4.4: fades by low water
    // E21.4: the open sea stays sea zoomed out
    if (t.blocked && f === 'water' && t.level !== undefined) return this.slab(b, PALETTE.ground.sea[t.variant % PALETTE.ground.sea.length], [t.x + 0.5, h + 0.04 - WATER.drop, t.z + 0.5], [1, 0.08, 1]);
    if (f === 'water' && t.level !== undefined && t.ground !== 'restored' && surfCell(t.x, t.z)) return this.slab(b, PALETTE.ground.shallows[t.variant % PALETTE.ground.shallows.length], [t.x + 0.5, h + 0.04 - WATER.drop, t.z + 0.5], [1, 0.08, 1]);
    const col = t.blocked ? (this.level >= 4 && f !== 'building' ? PALETTE.stone.light : dead[0]) : t.ground === 'restored' ? (f === 'water' ? ALIVE.water : f === 'paving' ? this.slabTone(t) : f === 'road' ? PALETTE.paving.roadAlive : grassTone(stage, t.x, t.z)) : t.ground === 'polluted' ? dead[t.variant % dead.length] : t.ground === 'growing' ? PALETTE.ground.growing : PALETTE.ground.prepared;
    this.slab(b, col, [t.x + 0.5, f === 'water' && !t.blocked ? h - WATER.drop : h, t.z + 0.5], [1, 0.16, 1]);
    // Phase 5 E16: stages stay apart zoomed out too: a colour patch for Blooming, a gold disc for Radiant.
    if (t.ground === 'restored' && f !== 'water' && f !== 'paving' && f !== 'road') {
      if (stage === 2) b.add('box', flowerAt(t.x, t.z), [t.x + 0.4, h + 0.085, t.z + 0.55], [0.34, 0.02, 0.3]);
      if (stage === 4) b.add('cylinder', PALETTE.flowers.radiantFar, [t.x + 0.5, h + 0.085, t.z + 0.5], [0.8, 0.02, 0.8]);
    }
    if (this.plotCells.has(`${t.x},${t.z}`)) return; // E19.1.5: the plot's own far look stands here
    if (this.addTree(t, h, 0)) return;
    if (t.ground === 'restored' && this.sim.water.bloomShown(t) >= 3 && f !== 'water') this.fb.add(shrubGeo(t.variant, 0), t.x + 0.5, h + 0.08, t.z + 0.5, t.variant, 1);
  }

  // ───────────── trees (Phase 5) ─────────────

  /** The foliage builder of the chunk being built, and its area type (tree species follow it). */
  private fb = new FoliageBuilder();
  private areaType = 'park';
  /** Foliage triangles per loaded chunk (perf readout). */
  readonly treeTris = new Map<string, number>();
  /** Look 3.17: ground + prop triangles per loaded chunk (perf readout). */
  readonly groundTris = new Map<string, number>();
  /** Look 3: what the surface builders (Surfaces.ts) need for the chunk being built */
  private ctx!: DressCtx;
  /**
   * Look 3 × Look 6: the sink the tile being drawn goes into. The chunk's own builder takes everything; a transition
   * sink takes plain primitives only, so template props and blended turf (addGeo / quad) wait for the static rebuild
   * when the transition ends.
   */
  private sink: Sink = { add() {}, grey: 0 };
  private solidSink(): SolidSink {
    const b = this.sink;
    if (b instanceof MeshBuilder) return b;
    // area-wave edges (#135): rails and clutter go through the transition builder so they grow in with the ivy
    if (b instanceof TrMeshBuilder) return { get grey() { return b.grey; }, add: (type, hex, p, sc, glow) => b.add(type, hex, p, sc, glow), addGeo: (g, x, y, z, r, s) => b.addGeo(g, x, y, z, r, s), quad() {} };
    return { get grey() { return b.grey; }, add: (type, hex, p, sc, glow) => b.add(type as 'box', hex, p, sc, glow), addGeo() {}, quad() {} };
  }

  /** #687: the drawn top of the tile being dressed (undefined between tiles, and for water and decks). */
  private fitNow?: GroundFit;
  /** #687: the foliage sink a tile's scatter goes through: each piece is moved in until its footprint is on the ground. */
  private readonly scatter = {
    add: (g: TreeGeo, x: number, y: number, z: number, rot: number, scale: number) => {
      if (this.fitNow) [x, z] = fitOnGround(this.fitNow, x, z, geoRadius(g) * scale);
      this.fb.add(g, x, y, z, rot, scale);
    },
  };
  /** #687: where a scattered piece of footprint radius `r` meant for (x, z) goes, so it stays on the tile's top. */
  private spot(x: number, z: number, r: number): [number, number] {
    return this.fitNow ? fitOnGround(this.fitNow, x, z, r) : [x, z];
  }
  /** #687: `spot` as a primitive's position, at height y. */
  private at(x: number, y: number, z: number, r: number): [number, number, number] {
    const [px, pz] = this.spot(x, z, r);
    return [px, y, pz];
  }

  /**
   * #687: a land tile's drawn top for `fitOnGround`: its square, the corners `landCuts` rounds off, and the sides
   * where the ground ends (water, a deck over water, or a lower terrace). Undefined for water and decks.
   */
  groundFit(t: TileData): GroundFit | undefined {
    if (t.feature === 'water' || this.overWater(t)) return undefined;
    const g = this.sim.grid;
    const top = t.level !== undefined ? levelY(t.level) : 0;
    const open = EDGE_DIRS.map(([dx, dz]) => {
      const n = g.peek(t.roofId, t.x + dx, t.z + dz);
      if (!n) return false;
      if (n.feature === 'water' || this.overWater(n)) return true;
      return t.level !== undefined && n.level !== undefined && levelY(n.level) < top - 1e-3;
    }) as GroundFit['open'];
    return { x0: t.x, z0: t.z, open, cut: this.landCuts(t) ?? [0, 0, 0, 0] };
  }

  /** Adds the tile's tree at its stage, unless it's growing on its own right now. True if the tile has one. */
  private addTree(t: TileData, h: number, lod: 0 | 1): boolean {
    if ((t.feature ?? 'lawn') === 'water') return false;
    const spot = treeSpot(t, this.areaType);
    if (!spot) return false;
    const stage = treeStage(t, this.sim.water.bloomShown(t)); // E23.4.4: trees fade with low water
    if (!stage) return false;
    if (this.growing.has(t.id)) return true;
    // Look 3.7: close-up trees at near zoom on High; the single-clump version at mid zoom and below
    const tl: Lod = lod === 1 && this.band >= 2 && this.detail === 'high' ? (this.band === 3 ? 3 : 2) : lod;
    this.fb.add(treeGeo(spot.species, stage, spot.variant, tl), t.x + 0.5, h + 0.08 + (spot.planter ? 0.16 : 0), t.z + 0.5, spot.rot, spot.scale);
    return true;
  }

  /** Fills the tree template cache a few milliseconds per frame after load (no first-pan generation spike). */
  private warm: Generator<void> | undefined = (function* () {
    yield* warmFlora(); // Look 3: grass, flowers and shrubs first (every restored tile uses them)
    yield* warmTemplates();
  })();
  private warmTrees() {
    if (!this.warm) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 3) if (this.warm.next().done) return void (this.warm = undefined);
  }

  /** Trees growing to a new stage right now: a pooled entity bounces up while the chunk leaves the tree out. */
  private growing = new Map<string, { e: pc.Entity; t: number; from: number; to: number; tile: TileData }>();
  static readonly GROW_SECONDS = 0.9;
  static readonly MAX_GROWING = 24;

  /** A tile's bloom stage rose (or it was restored): grow its tree, if it has one. */
  growTree(t: TileData, prevStage: number) {
    if (this.transitions) return; // Look 6.12: trees grow in through the transition mesh
    if (t.roofId !== GROUND || this.reducedMotion || this.growing.size >= ChunkRenderer.MAX_GROWING) return;
    const view = this.views.get(chunkKey(GROUND, Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK)));
    if (!view || view.far) return;
    const spot = treeSpot(t, this.sim.areas.info(this.sim.areas.areaOf(t)!).type);
    const stage = treeStage(t, this.sim.water.bloomShown(t));
    if (!spot || !stage || (t.feature ?? 'lawn') === 'water') return;
    const old = this.growing.get(t.id);
    old?.e.destroy();
    const e = new pc.Entity(`grow-${t.id}`);
    e.addComponent('render', { meshInstances: [new pc.MeshInstance(treeMesh(this.device, treeGeo(spot.species, stage, spot.variant, 1)), foliageMaterial())], castShadows: true, receiveShadows: true });
    const h = this.sim.grid.layer(GROUND)!.height;
    e.setLocalPosition(t.x + 0.5, h + 0.08 + (spot.planter ? 0.16 : 0), t.z + 0.5);
    e.setLocalEulerAngles(0, (-spot.rot * 180) / Math.PI, 0);
    this.root.addChild(e);
    // Relative size of the previous stage, so a young tree swells into a full one rather than popping from zero.
    const SIZE = [0, 0.32, 0.62, 1, 1.08];
    const from = prevStage >= 1 ? SIZE[prevStage] / SIZE[stage] : 0.05;
    this.growing.set(t.id, { e, t: 0, from, to: spot.scale, tile: t });
    e.setLocalScale(from * spot.scale, from * spot.scale, from * spot.scale);
    view.dirty = true;
  }

  private tickGrowing(dt: number) {
    for (const [id, g] of this.growing) {
      g.t += dt;
      const k = Math.min(1, g.t / ChunkRenderer.GROW_SECONDS);
      // ease-out with a soft overshoot: the tree springs up and settles
      const e = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
      const sc = g.to * (g.from + (1 - g.from) * e);
      g.e.setLocalScale(sc, sc * (1 + 0.06 * Math.sin(k * Math.PI)), sc);
      if (k >= 1) {
        this.growing.delete(id);
        this.markTile(g.tile); // the chunk takes the tree back…
        const ge = g.e;
        setTimeout(() => ge.destroy(), 120); // …and the stand-in goes once that rebuild has had a frame to land
      }
    }
  }

  /** Dev/perf readout: foliage triangles in loaded chunks. */
  foliageTris(): number {
    let n = 0;
    for (const k of this.views.keys()) n += this.treeTris.get(k) ?? 0;
    return n;
  }

  /** City 16: the planned road network of the chunk being built (ground generation 4+), for road pieces. */
  private roads?: RoadPlan;

  /**
   * City 16.6: a road tile's kerbs, markings and bridge, from its piece (so they follow the real road shape and
   * flow through junctions and across chunk borders). Kerbs on every side without road; a dashed centre line
   * between a street's two lanes on straights; an arterial's double centre line and edge lines; nothing painted in
   * junctions and corners. Lanes are paving, not road, so they never get here. Dead roads keep worn markings.
   */
  private roadMarks(b: Sink, p: RoadPiece, t: TileData, x: number, z: number, top: number, alive: boolean) {
    const y = top + 0.004;
    if (p.bridge) {
      b.add('box', alive ? PALETTE.paving.bridgeDeck : PALETTE.paving.bridgeDeckDead, [x, top + 0.02, z], [1, 0.05, 1]);
      for (const [dx, dz, bit] of ROAD_SIDES) {
        if (p.mask & bit) continue;
        b.add('box', PALETTE.paving.bridgeRail, [x + dx * 0.46, top + 0.16, z + dz * 0.46], [dx ? 0.05 : 1, 0.06, dz ? 0.05 : 1]);
        for (const k of [-0.4, 0, 0.4]) b.add('box', PALETTE.paving.bridgeRail, [x + (dx ? dx * 0.46 : k), top + 0.09, z + (dz ? dz * 0.46 : k)], [0.05, 0.14, 0.05]);
      }
      return;
    }
    for (const [dx, dz, bit] of ROAD_SIDES) {
      if (p.mask & bit) continue;
      b.add('box', alive ? PALETTE.paving.kerb : PALETTE.paving.kerbDead, [x + dx * 0.47, top + 0.02, z + dz * 0.47], [dx ? 0.06 : 1, 0.05, dz ? 0.06 : 1]);
    }
    if (p.kind !== 'straight') return;
    const worn = !alive && t.variant % 3 === 0; // dead roads lose a third of their paint
    if (worn) return;
    const alongX = (p.through & 3) === 3;
    // the two across-sides: lo (−z / −x) and hi (+z / +x)
    const lo = p.mask & (alongX ? 8 : 2);
    const hi = p.mask & (alongX ? 4 : 1);
    const at = (off: number, len: number, thick: number, col: string) =>
      b.add('box', col, alongX ? [x, y, z + off] : [x + off, y, z], alongX ? [len, 0.01, thick] : [thick, 0.01, len]);
    if (p.tier === 'arterial') {
      if (lo && hi) {
        at(-0.05, 1, 0.05, PALETTE.paving.roadLine);
        at(0.05, 1, 0.05, PALETTE.paving.roadLine);
      } else at(lo ? 0.36 : -0.36, 1, 0.05, PALETTE.paving.roadEdgeLine);
    } else if (hi && !lo && (alongX ? t.x : t.z) % 2 === 0) at(0.5, 0.5, 0.07, PALETTE.paving.roadLine); // dash on the shared seam
  }

  /** Look 3.17 budget readout: triangles in loaded chunks (ground + props, foliage) and the worst chunk. */
  detailStats() {
    let ground = 0, foliage = 0, worst = 0;
    for (const k of this.views.keys()) {
      const g = this.groundTris.get(k) ?? 0, f = this.treeTris.get(k) ?? 0;
      ground += g;
      foliage += f;
      worst = Math.max(worst, g + f);
    }
    return { chunks: this.views.size, ground, foliage, worstChunk: worst, band: this.band, tier: this.detail };
  }

  /** Look of the chunk being built: prop level 0–4, and whether it's the park. */
  private level = 0;
  /** E20.6 (#289): props look neglected until their area wakes (the park from its second stage). */
  private get neglected(): boolean {
    return this.level < 2;
  }
  private inPark = false;
  /** Phase 5 E16: the obstacle tile shown as this chunk's local landmark (cleared areas only). */
  private localMark?: string;

  /**
   * Phase 5 E16: a small local landmark on an obstacle cell (never a build cell), by area type: a flower arch on
   * streets and rooftops, an ivy statue in plazas, a topiary in markets, a lantern post with a hanging basket by
   * canals, a spouting basin at reservoirs, a mushroom ring in groves. Meshy hook: these are candidates for the
   * "edge clutter" / obstacle set in docs/art/meshy-assets.md.
   */
  private landmark(b: Sink, x: number, y: number, z: number, variant: number) {
    const flower = PALETTE.flower[variant % PALETTE.flower.length];
    switch (this.areaType) {
      case 'plaza':
        b.add('box', PALETTE.stone.light, [x, y + 0.12, z], [0.5, 0.24, 0.5]);
        b.add('capsule', PALETTE.stone.white, [x, y + 0.5, z], [0.18, 0.2, 0.16]);
        b.add('sphere', PALETTE.stone.white, [x, y + 0.78, z], 0.16);
        b.add('sphere', PALETTE.leaf.ivy, [x + 0.12, y + 0.4, z + 0.1], [0.16, 0.3, 0.1]); // ivy
        b.add('sphere', flower, [x - 0.2, y + 0.26, z + 0.2], 0.1);
        break;
      case 'market':
        b.add('box', PALETTE.stone.warm, [x, y + 0.1, z], [0.4, 0.2, 0.4]);
        b.add('sphere', PALETTE.leaf.shrub[0], [x, y + 0.42, z], [0.38, 0.4, 0.38]);
        b.add('sphere', PALETTE.leaf.shrub[1], [x, y + 0.74, z], [0.26, 0.28, 0.26]);
        b.add('sphere', PALETTE.leaf.shrubTip, [x, y + 0.95, z], 0.14);
        break;
      case 'canal':
        b.add('cylinder', PALETTE.metal.dark, [x, y + 0.55, z], [0.06, 1.1, 0.06]);
        b.add('box', PALETTE.metal.dark, [x + 0.15, y + 1.08, z], [0.34, 0.03, 0.03]);
        b.add('sphere', PALETTE.flowers.radiantDisc, [x + 0.3, y + 0.98, z], 0.12);
        b.add('sphere', PALETTE.leaf.shrub[1], [x, y + 0.7, z], [0.3, 0.16, 0.3]); // hanging basket
        b.add('sphere', flower, [x + 0.08, y + 0.74, z + 0.08], 0.1);
        break;
      case 'reservoir':
        b.add('cylinder', PALETTE.stone.light, [x, y + 0.1, z], [0.7, 0.2, 0.7]);
        b.add('cylinder', PALETTE.water, [x, y + 0.2, z], [0.6, 0.02, 0.6]);
        b.add('cylinder', PALETTE.stone.light, [x, y + 0.35, z], [0.1, 0.4, 0.1]);
        b.add('sphere', PALETTE.aqua.pale, [x, y + 0.6, z], [0.14, 0.18, 0.14]);
        break;
      case 'grove':
        b.add('cylinder', PALETTE.wood.bark, [x, y + 0.1, z], [0.42, 0.2, 0.42]);
        b.add('sphere', PALETTE.leaf.light, [x, y + 0.21, z], [0.4, 0.06, 0.4]);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const mx = x + Math.cos(a) * 0.36;
          const mz = z + Math.sin(a) * 0.36;
          b.add('cylinder', PALETTE.props.mushroomStem, [mx, y + 0.05, mz], [0.04, 0.1, 0.04]);
          b.add('sphere', i % 2 ? PALETTE.props.mushroom : PALETTE.flowers.radiantFar, [mx, y + 0.11, mz], [0.12, 0.06, 0.12]);
        }
        break;
      default: {
        // a white flower arch
        for (const s of [-1, 1]) b.add('cylinder', PALETTE.stone.white, [x + s * 0.32, y + 0.4, z], [0.06, 0.8, 0.06]);
        b.add('box', PALETTE.stone.white, [x, y + 0.82, z], [0.74, 0.06, 0.1]);
        for (let i = 0; i < 7; i++) {
          const k = i / 6;
          const px = x - 0.32 + k * 0.64;
          const py = y + 0.3 + Math.sin(k * Math.PI) * 0.56;
          b.add('sphere', i % 2 ? PALETTE.leaf.shrub[1] : flower, [px, py, z], 0.13);
        }
      }
    }
  }

  // ───────────── Look 6.12: transition hooks ─────────────

  /** The transition framework (Game sets it). Without it, chunks build exactly as before Look 6. */
  transitions?: TransitionRenderer;
  private slabCap?: (hex: string, p: [number, number, number], s: [number, number, number]) => void;

  /** E23.7.1: the fog sheets' tint by the time of day (unlit, so the light can't dim them): DayNight sets it */
  fogTint = new pc.Color(1, 1, 1);
  private fogTintBuilt = new pc.Color(1, 1, 1);

  /** E23.7.1: applies `fogTint` to every fog sheet when it changes (and to new sheets as they're built). */
  tintFog(force = false) {
    const t = this.fogTint;
    const b = this.fogTintBuilt;
    if (!force && Math.abs(t.r - b.r) + Math.abs(t.g - b.g) + Math.abs(t.b - b.b) < 0.004) return;
    b.copy(t);
    for (const v of this.views.values()) {
      if (!v.fogMat) continue;
      v.fogMat.emissive = new pc.Color(t.r, t.g, t.b);
      v.fogMat.update();
    }
  }

  /** Look 6.18: pushes each fogged chunk's receding front (if its area is clearing) to its fog material. */
  private fogFronts() {
    const tr = this.transitions!;
    for (const v of this.views.values()) {
      if (!v.fogMat) continue;
      const a = this.sim.areas.map.areaOfChunk(v.cx, v.cz);
      const f = v.fogHold ? tr.fogFront(a) : undefined;
      v.fogMat.setParameter('uFogFront', f ?? [0, 0, 0, 0]);
      if (v.fogHold && !tr.waving(a)) {
        v.fogHold = false;
        v.fogDirty = true;
      }
    }
  }

  /** A tile's ground slab: drawn by the living surface when transitions are on, else straight into the chunk. */
  private slab(b: Sink, hex: string, p: [number, number, number], s: [number, number, number]) {
    if (this.slabCap) this.slabCap(hex, p, s);
    else this.slabInto(b, hex, p, s);
  }

  /** E23.13: the tile being drawn, and the radius of each of its corners (CORNERS order) rounded off into water. */
  private cutNow?: { x: number; z: number; r: number[] };

  /**
   * E23.13: a tile's ground slab into `sink`. Where the tile pokes out into water (water on both sides of a corner and
   * across it), that corner is rounded off: the slab is laid as a cross of boxes with a smooth disc in each rounded
   * corner (a hair lower, so where it runs under the boxes they win), and square pieces in the others.
   */
  private slabInto(sink: Sink, hex: string, p: [number, number, number], s: [number, number, number]) {
    const c = this.cutNow;
    if (!c || s[0] !== 1 || s[2] !== 1 || p[0] !== c.x + 0.5 || p[2] !== c.z + 0.5) return sink.add('box', hex, p, s);
    const R = WATER.fillet;
    const [x, y, z] = p;
    sink.add('box', hex, p, [1, s[1], 1 - 2 * R]);
    sink.add('box', hex, [x, y, z - 0.5 + R / 2], [1 - 2 * R, s[1], R]);
    sink.add('box', hex, [x, y, z + 0.5 - R / 2], [1 - 2 * R, s[1], R]);
    CORNERS.forEach(([sx, sz], i) => {
      if (c.r[i]) sink.add('disc', hex, [x + sx * (0.5 - R), y - 0.001, z + sz * (0.5 - R)], [2 * R, s[1], 2 * R]);
      else sink.add('box', hex, [x + sx * (0.5 - R / 2), y, z + sz * (0.5 - R / 2)], [R, s[1], R]);
    });
  }

  /**
   * E23.13: the radius of each corner of a land tile (CORNERS order) that pokes out into water, rounded off as a
   * pool's inside corners are (water on both sides of the corner and across it, at the same level). Undefined when
   * none is (and for water, decks over water, ramps and raised paving, which keep their square shapes).
   */
  private landCuts(t: TileData): number[] | undefined {
    if (t.feature === 'water' || t.ramp || this.overWater(t) || this.raisedPaving(t)) return undefined;
    const g = this.sim.grid;
    const wet = (dx: number, dz: number) => {
      const n = g.peek(t.roofId, t.x + dx, t.z + dz);
      return !!n && n.level === t.level && this.bankless(n);
    };
    const r = CORNERS.map(([sx, sz]) => (wet(sx, 0) && wet(0, sz) && wet(sx, sz) ? WATER.fillet : 0));
    return r.some((k) => k) ? r : undefined;
  }

  /** E23.13: a land tile's outline, closed, its corners rounded where `landCuts` says (round the tile in CORNERS order). */
  private cutRing(t: TileData, cut: number[]): [number, number][] {
    const ring: [number, number][] = [];
    CORNERS.forEach(([sx, sz], i) => {
      const cx = t.x + 0.5 + sx * 0.5;
      const cz = t.z + 0.5 + sz * 0.5;
      if (!cut[i]) {
        ring.push([cx, cz]);
        return;
      }
      // the arc runs from the corner's x edge round to its z edge: going round in CORNERS order, the even corners are
      // reached along their x edge, the odd ones along their z edge
      const arc = this.arc(cx, cz, sx, sz, cut[i]);
      ring.push(...(i % 2 ? arc.reverse() : arc));
    });
    ring.push(ring[0]);
    return ring;
  }

  /**
   * E23.13: under each rounded corner of a land tile, the water it opens onto: a corner square of the water across
   * the corner (its slab, a clear pool's surface, or a dead pond's silt).
   */
  private cutWater(b: MeshBuilder, t: TileData, th: number, cut: number[], pool: PoolGeo, gtex: GroundTexGeo[]) {
    const g = this.sim.grid;
    const keep = b.grey;
    CORNERS.forEach(([sx, sz], i) => {
      const R = cut[i];
      const n = R ? g.peek(t.roofId, t.x + sx, t.z + sz) : undefined;
      if (!n) return;
      const x0 = sx > 0 ? t.x + 1 - R : t.x;
      const z0 = sz > 0 ? t.z + 1 - R : t.z;
      const surf = th + 0.08 - WATER.drop;
      b.grey = this.greyOf(n);
      b.add('box', this.waterHex(n), [x0 + R / 2, surf - 0.04, z0 + R / 2], [R, 0.08, R]);
      const sq: [number, number][] = [[x0, z0], [x0 + R, z0], [x0 + R, z0 + R], [x0, z0 + R]];
      if (this.isWater(n) && this.siltBed(n)) {
        const k = Math.round(255 * (1 - 0.3 * b.grey));
        addGroundFan(gtex[GROUND_TEXTURES.indexOf('silt-bed')], 'silt-bed', sq[0], sq.slice(1), surf + 0.002, [k, k, k]);
      }
      // a clear pool's surface carries on into the corner, at its bank (pale shallows and foam)
      if (this.isWater(n) && (n.ground === 'restored' || pondCell(n.x, n.z)) && this.fog !== 'hidden') {
        const shallow = lin(PALETTE.aqua.foam).map((v) => Math.round(v * 255));
        const base = pool.pos.length / 3;
        for (const [px, pz] of sq) {
          pool.pos.push(px, surf + 0.003, pz);
          pool.col.push(shallow[0], shallow[1], shallow[2], 0);
        }
        pool.idx.push(base, base + 3, base + 1, base + 1, base + 3, base + 2);
      }
    });
    b.grey = keep;
  }

  /** E23.13: the colour a water tile's slab is drawn in (as `tile` and `waterTile` draw it). */
  private waterHex(n: TileData): string {
    const v = n.variant;
    if (this.overWater(n) || (n.blocked && !pondCell(n.x, n.z))) {
      const sea = shallowSea(n.x, n.z) || (n.level !== undefined && (regionWater(n.x, n.z) || onJetty(n.x, n.z)) && inSurfBand(n.x, n.z)) ? PALETTE.ground.shallows : PALETTE.ground.sea;
      return sea[v % sea.length];
    }
    if (n.level !== undefined && n.ground !== 'restored' && surfCell(n.x, n.z)) return PALETTE.ground.shallows[v % PALETTE.ground.shallows.length];
    return n.ground === 'restored' || this.livePond(n) ? ALIVE.water : n.ground === 'polluted' ? PALETTE.aqua.bed : PALETTE.ground.wetSoil;
  }

  private readonly host: ChunkHost = (() => {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      tile: (sink: Sink, t: TileData, h: number) => self.tile(sink, t, h),
      far: (sink: Sink, t: TileData, h: number) => self.farTile(sink, t, h),
      setFoliage: (f: GeoSink | undefined) => {
        self.fb = (f ?? self.chunkFb) as FoliageBuilder;
      },
      edges: (sink: Sink, t: TileData, h: number) => {
        self.sink = sink;
        areaEdges(self.ctx, t, h + 0.08);
      },
      withLevel: (level: number, fn: () => void) => {
        const old = self.level;
        self.level = level;
        fn();
        self.level = old;
      },
      get slabCap() {
        return self.slabCap;
      },
      slab: (sink: Sink, hex: string, p: [number, number, number], s: [number, number, number]) => self.slabInto(sink, hex, p, s),
      set slabCap(v) {
        self.slabCap = v;
      },
    };
  })();
  private chunkFb = new FoliageBuilder();

  private tile(b: Sink, t: TileData, h: number) {
    const keep = this.fitNow;
    this.fitNow = this.groundFit(t);
    try {
      this.dressTile(b, t, h);
    } finally {
      this.fitNow = keep;
    }
  }

  private dressTile(b: Sink, t: TileData, h: number) {
    this.sink = b;
    const cut = this.landCuts(t);
    this.cutNow = cut && { x: t.x, z: t.z, r: cut };
    const x = t.x + 0.5;
    const z = t.z + 0.5;
    // E23.7.4: a salvage pile blown back onto ground bloombot restored sits on that ground (never on a dead slab)
    if (t.blocked && t.ground === 'restored' && t.prop?.startsWith('pile:')) {
      t.blocked = false;
      try {
        this.tile(b, t, h);
      } finally {
        t.blocked = true;
      }
      this.sink = b;
      this.oldCityProp(b, t, x, h + 0.08, z);
      return;
    }
    const f = t.feature ?? 'lawn';
    const r = new VRng(t.variant * 7919 + 13);
    const dead = paintedDead(t) ?? DEAD[f] ?? DEAD.lawn;
    // E21.26: the Landing's jetty: its model (once it lands) from the first plank, else procedural planks on posts
    if (t.level !== undefined && onJetty(t.x, t.z)) {
      const J = LANDING.jetty;
      const model = oldCityModel('jetty');
      if (model === 'jetty') {
        // the model (8 m long along +X, 5.2 m wide, 4.2 m from its posts' feet to the deck) at half size, turned along
        // the jetty (its end rail out to sea), deck at the beach
        const sc = J.d / 8;
        // water under the planks: the shallow surf where the jetty starts, open sea further out
        const under = surfCell(t.x, t.z) || !seaCell(t.x, t.z + 1) ? PALETTE.ground.shallows : PALETTE.ground.sea;
        this.slab(b, under[t.variant % under.length], [x, h + 0.04 - WATER.drop, z], [1, 0.08, 1]);
        // its deck is 1.7 m up the model (the rope posts rise above it), so that height goes at the beach, not the top
        if (t.x === J.x && t.z === J.z) this.batch?.add('jetty', J.x + J.w / 2, h + 0.08 - JETTY_DECK * sc, J.z + J.d / 2, LANDING.jettyYaw, sc, sc, sc);
        return;
      }
      const sea = PALETTE.ground.sea;
      this.slab(b, sea[t.variant % sea.length], [x, h + 0.04 - WATER.drop, z], [1, 0.08, 1]);
      for (let i = 0; i < 4; i++) b.add('box', i % 2 ? PALETTE.wood.mid : PALETTE.wood.dark, [x, h + 0.06, z - 0.375 + i * 0.25], [0.98, 0.05, 0.22]);
      if (t.x === J.x || t.x === J.x + J.w - 1) b.add('cylinder', PALETTE.wood.deep, [t.x === J.x ? x - 0.42 : x + 0.42, h - 0.25, z], [0.09, 0.7, 0.09]);
      return;
    }
    // E23.13: a gate or bridge standing on a canal keeps the canal under it: the water, then the barricade on it while
    // it's shut, or a plank boardwalk across once it's open (planks run along the canal, so you walk across them)
    if (t.feature === 'obstacle' && this.overWater(t)) {
      const sea = PALETTE.ground.sea;
      this.slab(b, sea[t.variant % sea.length], [x, h + 0.04 - WATER.drop, z], [1, 0.08, 1]);
      if (t.blocked && t.prop && this.oldCityProp(b, t, x, h + 0.08, z)) return;
      for (let i = 0; i < 4; i++) b.add('box', i % 2 ? PALETTE.wood.mid : PALETTE.wood.dark, [x - 0.375 + i * 0.25, h + 0.06, z], [0.22, 0.05, 0.98]);
      b.add('cylinder', PALETTE.wood.deep, [x, h - 0.25, t.z % 2 ? z + 0.42 : z - 0.42], [0.09, 0.7, 0.09]);
      return;
    }
    // E23.8.3.1: the Long Causeway's broken middle: its low deck under the sea, a few deck stones breaking the surface,
    // until the Great Bloom raises it (then it draws as the road it is)
    if (t.blocked && t.prop === 'causeway-broken') {
      const sea = PALETTE.ground.sea;
      this.slab(b, sea[t.variant % sea.length], [x, h + 0.04 - WATER.drop, z], [1, 0.08, 1]);
      if (t.variant % 3 === 0) b.add('box', PALETTE.stone.light, [x + r.range(-0.25, 0.25), h + 0.02 - WATER.drop, z + r.range(-0.25, 0.25)], [r.range(0.3, 0.55), 0.16, r.range(0.25, 0.45)]);
      if (t.variant % 4 === 1) b.add('box', PALETTE.paving.grout, [x + r.range(-0.3, 0.3), h - WATER.drop, z + r.range(-0.3, 0.3)], [0.3, 0.1, 0.24]);
      return;
    }
    // a natural pond in a region (the Cistern's): a pool, with banks, not open water
    if (f === 'water' && t.blocked && pondCell(t.x, t.z)) return this.waterTile(b, t, h, x, z, r);
    // E21.4: the Old City's open sea: deep water, never restored
    if (t.blocked && f === 'water') {
      // E23.13: the bay's ragged shallow shelf, and a canal where it runs out through the surf, are the shallows' colour
      const sea = shallowSea(t.x, t.z) || (t.level !== undefined && regionWater(t.x, t.z) && inSurfBand(t.x, t.z)) ? PALETTE.ground.shallows : PALETTE.ground.sea;
      this.slab(b, sea[t.variant % sea.length], [x, h + 0.04 - WATER.drop, z], [1, 0.08, 1]);
      if (t.variant % 5 === 0) b.add('box', PALETTE.ground.seaFoam, [x + r.range(-0.3, 0.3), h + 0.085 - WATER.drop, z + r.range(-0.3, 0.3)], [r.range(0.2, 0.5), 0.006, 0.05]);
      return;
    }
    if (t.blocked) {
      // Look 2.5: once its area is alive, an obstacle stands on a clean stone plinth instead of dead ground.
      if (t.feature !== 'building' && this.level >= 4) {
        this.slabInto(b, PALETTE.paving.grout, [x, h - 0.004, z], [1, 0.152, 1]);
        this.slab(b, PALETTE.stone.light, [x, h + 0.02, z], [0.9, 0.2, 0.9]);
      } else this.slab(b, dead[t.variant % dead.length], [x, h, z], [1, 0.16, 1]);
      if (t.feature === 'building') return;
      if (t.prop && this.oldCityProp(b, t, x, h + 0.08, z)) return; // E21: piles, barricades, the shed, Keepers
      if (t.id === this.localMark) this.landmark(b, x, h + 0.08, z, t.variant);
      else if ((t.prop ?? 'stump') === 'stump' && dhash(t.x, t.z, 211) < 0.45) planterBed(this.ctx, t, this.level >= 3, x, z, h + 0.08, 0.82, 0.82); // Look 3.9
      else this.prop(b, t.prop ?? 'stump', x, h + 0.08, z, r);
      obstacleClutter(this.ctx, t, x, z, h + 0.08); // Look 3.11
      return;
    }
    if (t.occupantId || this.plotCells.has(`${t.x},${t.z}`)) {
      this.slab(b, t.ground === 'restored' ? (t.feature === 'paving' ? this.slabTone(t) : grassTone(Math.max(1, this.sim.water.bloomShown(t) || 1), t.x, t.z)) : PALETTE.soil, [x, h, z], [1, 0.16, 1]);
      return;
    }
    const top = h + 0.08;
    if (f === 'water') return this.waterTile(b, t, h, x, z, r);
    switch (t.ground) {
      case 'polluted': {
        const shade = t.pollution > 80 ? dead[(t.variant + 1) % dead.length] : dead[t.variant % dead.length];
        if (f === 'paving' && !paintedDead(t)) {
          // Look 3.2: cracked slabs with weeds in the gaps (scrubbed lighter once the park is swept)
          paving(this.ctx, t, false, x, z, h, this.inPark && this.level >= 1);
          if (!(this.inPark && this.level >= 1) && this.inPark) for (let i = 0; i < 2; i++) b.add('sphere', [PALETTE.soilDark, PALETTE.soil][i], this.at(x + r.range(-0.35, 0.35), top + 0.04, z + r.range(-0.35, 0.35), 0.07), [0.14, 0.025, 0.09]);
          break;
        }
        if (paintedDead(t)) {
          // Painted ground (GroundTex) lies on top: this slab only gives it sides where it meets lower ground. No
          // drawn cracks or dirt patches (the painting has them); a few dry tufts and leaves stand on it.
          this.slab(b, shade, [x, h, z], [1, 0.16, 1]);
          if (f === 'litter') for (let i = 0; i < 2; i++) b.add('sphere', PALETTE.ground.leafLitter[i % 3], this.at(x + r.range(-0.35, 0.35), top + 0.016, z + r.range(-0.35, 0.35), 0.08), [0.16, 0.03, 0.1]);
          if (f !== 'sand' && r.next() < (f === 'paving' ? 0.15 : 0.35)) this.scatter.add(grassGeo(0, t.variant + 1, 1), x + r.range(-0.3, 0.3), top, z + r.range(-0.3, 0.3), t.variant * 2, 1);
          if (t.variant % 7 === 0) this.scatter.add(grassGeo(0, t.variant + 1, 1), x + r.range(-0.3, 0.3), top, z + r.range(-0.3, 0.3), t.variant, 0.8);
          break;
        }
        this.slab(b, shade, [x, h, z], [1, 0.16, 1]);
        if (f === 'road') {
          const piece = this.roads?.pieceAt(t.x, t.z);
          if (piece) this.roadMarks(b, piece, t, x, z, top, false);
          else if (t.variant % 3 === 0) b.add('box', PALETTE.paving.roadLine, [x, top + 0.004, z], [0.12, 0.01, 0.4]);
        } else if (this.inPark && this.level >= 1) {
          // Swept: the litter is gone, a few weeds remain.
          if (t.variant % 3 === 0) {
            const [gx, gz] = [x + r.range(-0.2, 0.2), z + r.range(-0.2, 0.2)];
            const w = r.range(0.2, 0.4);
            b.add('box', PALETTE.paving.grout, this.at(gx, top + 0.004, gz, w / 2), [w, 0.01, 0.03]);
          }
          if (r.next() < 0.5) this.scatter.add(grassGeo(0, t.variant, 1), x + r.range(-0.3, 0.3), top, z + r.range(-0.3, 0.3), t.variant, 1);
        } else {
          for (let i = 0; i < 1 + (t.variant % 2); i++) {
            const [kx, kz] = [x + r.range(-0.25, 0.25), z + r.range(-0.25, 0.25)];
            const w = r.range(0.3, 0.6);
            b.add('box', PALETTE.paving.crack, this.at(kx, top + 0.004, kz, w / 2), [w, 0.01, 0.035]);
          }
          // Look 2.6: weathered, not flat: a rust streak on hard ground, a dirt patch on soft ground (seeded).
          const wx = hash01(t.x, t.z, 91);
          if (wx < 0.22 && f === 'obstacle') {
            const len = 0.3 + hash01(t.x, t.z, 93) * 0.3;
            b.add('box', PALETTE.ground.rustStreak, this.at(x + (hash01(t.x, t.z, 92) - 0.5) * 0.5, top + 0.003, z, len / 2), [0.05, 0.008, len]);
          } else if (wx < 0.3) b.add('sphere', PALETTE.ground.dirt, this.at(x + (hash01(t.x, t.z, 94) - 0.5) * 0.4, top + 0.002, z + (hash01(t.x, t.z, 95) - 0.5) * 0.4, 0.18), [0.36, 0.02, 0.28]);
          if (r.next() < 0.6) this.scatter.add(grassGeo(0, t.variant + 1, 1), x + r.range(-0.3, 0.3), top, z + r.range(-0.3, 0.3), t.variant * 2, 1.1);
          // Leaf litter: groves always, the dilapidated park until its paths are swept.
          if (f === 'litter' || this.inPark) for (let i = 0; i < (this.inPark ? 2 + (t.variant % 3) : 3); i++) b.add('sphere', PALETTE.ground.leafLitter[i % 3], this.at(x + r.range(-0.35, 0.35), top + 0.01, z + r.range(-0.35, 0.35), 0.08), [0.16, 0.03, 0.1]);
        }
        break;
      }
      case 'prepared':
      case 'growing': {
        this.slab(b, t.ground === 'growing' ? PALETTE.ground.growing : PALETTE.ground.prepared, [x, h, z], [1, 0.16, 1]);
        const n = t.ground === 'growing' ? 5 : 3 + (t.variant % 3);
        for (let i = 0; i < n; i++) {
          const sx = x + r.range(-0.3, 0.3);
          const sz = z + r.range(-0.3, 0.3);
          if (t.ground === 'growing') this.scatter.add(grassGeo(1, t.variant + i, 1), sx, top, sz, i * 1.7, 0.8);
          else {
            const [mw, md] = [r.range(0.14, 0.26), r.range(0.12, 0.24)];
            b.add('sphere', PALETTE.moss, this.at(sx, top + 0.005, sz, Math.max(mw, md) / 2), [mw, 0.05, md]);
          }
        }
        break;
      }
      case 'restored': {
        this.restoredTile(b, t, h, x, z, top, f, r);
        break;
      }
    }
    // E23.2.2.3: a buried find the ripple revealed: a little mound of turned earth with a sprout, until dug up
    if (t.roofId === GROUND && this.sim.buried?.known(t.x, t.z)) {
      // (the mound moves as one: it is fitted by its widest part)
      const [mx, mz] = this.spot(x + 0.08, z - 0.06, 0.18);
      const [ox, oz] = [mx - x - 0.08, mz - z + 0.06];
      b.add('sphere', PALETTE.turnedEarth, [mx, top + 0.02, mz], [0.36, 0.11, 0.3]);
      b.add('sphere', PALETTE.turnedEarthDark, [x + 0.02 + ox, top + 0.06, z - 0.02 + oz], [0.18, 0.07, 0.15]);
      this.fb.add(grassGeo(2, t.variant, 1), x + 0.04 + ox, top + 0.06, z - 0.04 + oz, t.variant, 0.5);
    }
  }

  // ───────────── curved paths ─────────────

  /** Paving a path can curve through: open, or under a landmark or machine (the plaza runs on under the fountain). */
  private isPath(t: TileData | undefined): t is TileData {
    return !!t && !t.blocked && t.feature === 'paving';
  }

  /** Soft ground a path curves against: open lawn, leaf litter or clay. */
  private isSoft(t: TileData | undefined): t is TileData {
    if (!t || t.blocked || t.occupantId) return false;
    const f = t.feature ?? 'lawn';
    return f === 'lawn' || f === 'litter' || f === 'clay';
  }

  /** The painted texture a tile's top wears now (dead, unoccupied Old City ground), if any. */
  private paintedTop(t: TileData | undefined): GroundTexName | undefined {
    return t && t.level !== undefined && !t.occupantId && t.ground === 'polluted' && !this.overWater(t) ? this.paintedGround(t) : undefined;
  }

  /** Dead painted paving: it stands a little above the earth beside it. */
  private raisedPaving(t: TileData | undefined): boolean {
    return !!t && this.isPath(t) && this.paintedTop(t) === 'dead-paving';
  }

  /**
   * A dead paved tile's painted top, raised a little above the earth: rounded where a corner is cut back against
   * soft ground (as `pathCorners` cuts it), with a stone lip down every side and curve that meets lower ground and
   * a soft contact shadow painted on the earth beside the lip, so the paving reads as standing higher.
   */
  private pavedTop(b: MeshBuilder, t: TileData, h: number, gtex: GroundTexGeo[], k: number) {
    const g = this.sim.grid;
    const cx = t.x + 0.5;
    const cz = t.z + 0.5;
    const R = PATH_CURVE.radius;
    const yTop = h + 0.086 + PAVING_RAISE.lift;
    const yBot = h + 0.08;
    const at = (dx: number, dz: number) => g.peek(t.roofId, t.x + dx, t.z + dz);
    const level = (n: TileData | undefined) => !!n && n.level === t.level;
    const ring: [number, number][] = [];
    /** per ring segment (from its point to the next): the lower ground it meets, a curve or not; undefined: none */
    const low: ({ n?: TileData; curve: boolean } | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      const [sx, sz] = CORNERS[i];
      const xFirst = i % 2 === 0; // the ring runs from the x side round to the z side at this corner, or back
      const nx = at(sx, 0);
      const nz = at(0, sz);
      // (rounded only where both sides are at this height: over a drop the corner stays square, like the wall under it)
      if (this.isSoft(nx) && this.isSoft(nz) && level(nx) && level(nz)) {
        for (let j = 0; j < PATH_CURVE.arc; j++) {
          const a = ((xFirst ? j : PATH_CURVE.arc - j) / PATH_CURVE.arc) * (Math.PI / 2);
          ring.push([cx + sx * R * Math.cos(a), cz + sz * R * Math.sin(a)]);
          low.push({ n: nx, curve: true });
        }
        continue;
      }
      const side = (n: TileData | undefined) => (this.raisedPaving(n) && level(n) ? undefined : { n, curve: false });
      ring.push(xFirst ? [cx + sx * 0.5, cz] : [cx, cz + sz * 0.5]);
      low.push(side(xFirst ? nx : nz));
      ring.push([cx + sx * 0.5, cz + sz * 0.5]);
      low.push(side(xFirst ? nz : nx));
    }
    const geo = gtex[GROUND_TEXTURES.indexOf('dead-paving')];
    addGroundFan(geo, 'dead-paving', [cx, cz], [...ring, ring[0]], yTop, [k, k, k]);
    const dark = Math.round(k * PAVING_RAISE.dark);
    for (let i = 0; i < ring.length; i++) {
      const e = low[i];
      if (!e) continue;
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      // outward: away from the tile's centre
      let nx = q[1] - p[1];
      let nz = -(q[0] - p[0]);
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      if (nx * ((p[0] + q[0]) / 2 - cx) + nz * ((p[1] + q[1]) / 2 - cz) < 0) [nx, nz] = [-nx, -nz];
      const N: V3 = [nx, 0, nz];
      b.tri(PALETTE.ground.pavingKerb, [p[0], yTop, p[1]], [q[0], yTop, q[1]], [q[0], yBot, q[1]], N);
      b.tri(PALETTE.ground.pavingKerb, [p[0], yTop, p[1]], [q[0], yBot, q[1]], [p[0], yBot, p[1]], N);
      // the lip's shadow on the painted earth beside it (level with this tile)
      const name = level(e.n) ? this.paintedTop(e.n) : undefined;
      if (!name || name === 'dead-paving') continue;
      const w = PAVING_RAISE.shadow;
      // along a curve the band fans out from the tile's centre, so its pieces meet without gaps
      const out = (pt: [number, number]): [number, number] => (e.curve ? [pt[0] + ((pt[0] - cx) / R) * w, pt[1] + ((pt[1] - cz) / R) * w] : [pt[0] + nx * w, pt[1] + nz * w]);
      addGroundStrip(gtex[GROUND_TEXTURES.indexOf(name)], name, [p, q], [out(p), out(q)], h + (e.curve ? 0.1 : 0.09), [dark, dark, dark], [k, k, k]);
    }
  }

  /**
   * Paths are laid on square tiles; this rounds them. Where a paved tile turns an outer corner against soft ground,
   * the corner is cut back to a quarter circle and the ground beyond grows into it; where soft ground sits in the
   * crook of a path, the paving fills its corner the same way. Stepped runs of tiles then read as one winding path
   * and a blocky disc as a round plaza. Each piece takes the colour of the tile it extends, at that tile's state,
   * and restored paving keeps its white border along the curve. Dead painted ground (GroundTex) carries its painting
   * on over the piece, so the corner blends into the tile it extends.
   */
  private pathCorners(b: MeshBuilder, t: TileData, h: number, gtex?: GroundTexGeo[]) {
    const paved = this.isPath(t);
    if (!paved && !this.isSoft(t)) return;
    const g = this.sim.grid;
    const R = PATH_CURVE.radius;
    const top = h + 0.08;
    const keep = b.grey;
    for (const [sx, sz] of CORNERS) {
      const nx = g.peek(t.roofId, t.x + sx, t.z);
      const nz = g.peek(t.roofId, t.x, t.z + sz);
      // both sides of the corner must be the other kind of ground, at this tile's height: where either side drops (a
      // terrace's wall, a step) the corner stays square, as the wall under it is (a curve on top would leave the
      // wall's square corner poking out under it)
      if (paved ? !this.isSoft(nx) || !this.isSoft(nz) : !this.isPath(nx) || !this.isPath(nz)) continue;
      if (nx!.level !== t.level || nz!.level !== t.level) continue;
      const from = nx!; // the tile whose ground spreads into this corner
      const alive = t.ground === 'restored' && from.ground === 'restored' && nz!.ground === 'restored';
      const cx = t.x + 0.5 + sx * 0.5;
      const cz = t.z + 0.5 + sz * 0.5;
      // centre of the quarter circle, and its rim from the x edge round to the z edge
      const ox = cx - sx * R;
      const oz = cz - sz * R;
      const rim = (rad: number): [number, number][] => {
        const out: [number, number][] = [];
        for (let i = 0; i <= PATH_CURVE.arc; i++) {
          const a = (i / PATH_CURVE.arc) * (Math.PI / 2);
          out.push([ox + sx * rad * Math.cos(a), oz + sz * rad * Math.sin(a)]);
        }
        return out;
      };
      // dead paving filling a corner stands as high as the paving it extends (its side is the stone lip)
      const raised = !paved && this.raisedPaving(from);
      const y = raised ? top + 0.002 + PAVING_RAISE.lift : top + (alive ? PATH_CURVE.lift : PATH_CURVE.liftDead);
      b.grey = this.greyOf(from);
      b.prism(raised ? PALETTE.ground.pavingKerb : this.topColour(from), [cx, cz], rim(R), false, y, top - 0.02);
      // the same painted ground as the tile it extends (as `build` lays it over that tile's slab)
      const gt = gtex ? this.paintedTop(from) : undefined;
      if (gt) {
        const k = Math.round(255 * (1 - 0.3 * b.grey));
        addGroundFan(gtex![GROUND_TEXTURES.indexOf(gt)], gt, [cx, cz], rim(R), y + 0.004, [k, k, k]);
      }
      // the lip's contact shadow on this tile's own earth, inside the curve
      const own = raised && gtex ? this.paintedTop(t) : undefined;
      if (own) {
        const k = Math.round(255 * (1 - 0.3 * keep));
        const d = Math.round(k * PAVING_RAISE.dark);
        addGroundStrip(gtex![GROUND_TEXTURES.indexOf(own)], own, rim(R), rim(R - PAVING_RAISE.shadow), top + 0.01, [d, d, d], [k, k, k]);
      }
      b.grey = keep;
      if (!alive) continue;
      // the white border follows the curve, on the paved side of it
      const w = PATH_CURVE.border;
      const inner = rim(paved ? R - w : R);
      const outer = rim(paved ? R : R + w);
      const yb = y + 0.012;
      for (let i = 0; i < PATH_CURVE.arc; i++) {
        const A: V3 = [inner[i][0], yb, inner[i][1]];
        const B: V3 = [outer[i][0], yb, outer[i][1]];
        const C: V3 = [outer[i + 1][0], yb, outer[i + 1][1]];
        const D: V3 = [inner[i + 1][0], yb, inner[i + 1][1]];
        b.tri(PALETTE.stone.bright, A, B, C, UP);
        b.tri(PALETTE.stone.bright, A, C, D, UP);
      }
    }
  }

  // ───────────── pools ─────────────

  /** Fog of the area being built (bank colours are greyed like the tile they copy). */
  private fog = 'cleared';

  /** A pool whose banks grow reeds and moss: restored, or a natural pond once its region is awake (cleared). */
  private poolAlive(t: TileData): boolean {
    return t.ground === 'restored' || (pondCell(t.x, t.z) && this.fog === 'cleared');
  }

  /** A pool tile: shallow water, or a region's natural pond (deep, but drawn as a pool). */
  private isWater(t: TileData | undefined): t is TileData {
    return !!t && !t.occupantId && t.feature === 'water' && (!t.blocked || pondCell(t.x, t.z));
  }

  /**
   * E23.13: a neighbour a pool's bank never walls off: other water (surf, the open bay, a canal) or a deck standing
   * over water (the jetty, a canal's boardwalk bridge), which has water under it too.
   */
  private bankless(n: TileData): boolean {
    return n.feature === 'water' || this.overWater(n); // (isWater's pools and ponds are water too)
  }

  /** E23.13: a tile that stands over water and keeps the water drawn under it (the jetty; a gate or bridge on a canal). */
  private overWater(t: TileData): boolean {
    return t.level !== undefined && (onJetty(t.x, t.z) || (t.feature === 'obstacle' && regionWater(t.x, t.z)));
  }

  /** The colour of a tile's top, as `tile` draws it (pool banks borrow it from the neighbouring tile). */
  private topColour(t: TileData): string {
    const f = t.feature ?? 'lawn';
    const dead = DEAD[f] ?? DEAD.lawn;
    if (t.blocked) return f !== 'building' && this.level >= 4 ? PALETTE.paving.grout : dead[t.variant % dead.length];
    const stage = Math.max(1, Math.min(4, this.sim.water.bloomShown(t) || 1)); // E23.4.4: fades by low water
    if (t.occupantId) return t.ground === 'restored' ? grassTone(stage, t.x, t.z) : PALETTE.soil;
    if (t.ground === 'restored') return f === 'paving' ? this.slabTone(t) : f === 'road' ? PALETTE.paving.roadAlive : grassTone(stage, t.x, t.z);
    if (t.ground === 'growing') return PALETTE.ground.growing;
    if (t.ground === 'prepared') return PALETTE.ground.prepared;
    // dead painted ground: the painting's own colour, so walls and banks cut from it match the top beside them
    const painted = t.ground === 'polluted' ? paintedDead(t) : undefined;
    if (painted) return painted[t.variant % painted.length];
    if (f === 'paving' && this.inPark && this.level >= 1) return PALETTE.paving.swept;
    return t.pollution > 80 ? dead[(t.variant + 1) % dead.length] : dead[t.variant % dead.length];
  }

  private greyOf(t: TileData): number {
    return this.fog === 'hidden' ? 0.75 : this.fog === 'cleared' || t.ground === 'restored' ? 0 : 0.35;
  }

  /** Quarter arc inside a tile corner: from the x edge round to the z edge, bulging towards the corner. */
  private arc(cx: number, cz: number, sx: number, sz: number, r: number): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i <= WATER.arc; i++) {
      const a = (i / WATER.arc) * (Math.PI / 2);
      out.push([cx - sx * r + sx * r * Math.cos(a), cz - sz * r + sz * r * Math.sin(a)]);
    }
    return out;
  }

  /**
   * A pool tile's surface: water below ground level (a silted bed when polluted, clear with lily pads once
   * restored). Its banks are `poolBanks`.
   */
  /** A dead shallow pond tile: its bed wears the painted silt (`silt-bed`). Not the surf, not deep water. */
  private siltBed(t: TileData): boolean {
    if (this.livePond(t)) return false; // its water is back: the bed it bares as it drains is WaterLevels'
    return t.ground === 'polluted' && (!t.blocked || pondCell(t.x, t.z)) && !(t.level !== undefined && surfCell(t.x, t.z));
  }

  /**
   * A region's natural pond whose landmark has woken (the Cistern's): living water, drawn as a restored pool is (its
   * bed a clear pool's, not the dead silt, which would show through the surface's tile seams as dark dots).
   */
  private livePond(t: TileData): boolean {
    return t.ground !== 'restored' && pondCell(t.x, t.z) && this.poolAlive(t);
  }

  private waterTile(b: Sink, t: TileData, h: number, x: number, z: number, r: VRng) {
    const surf = h + 0.08 - WATER.drop;
    // the beach's surf is shallow sea, murky while dead: never the dried-out canal bed
    const shallows = t.level !== undefined && t.ground !== 'restored' && surfCell(t.x, t.z);
    // a dead pond's slab is one colour, the painted silt's own (its top wears the silt texture: see `siltBed`)
    const hex = shallows ? PALETTE.ground.shallows[t.variant % PALETTE.ground.shallows.length] : t.ground === 'restored' || this.livePond(t) ? ALIVE.water : t.ground === 'polluted' ? PALETTE.aqua.bed : PALETTE.ground.wetSoil;
    this.slab(b, hex, [x, surf - 0.04, z], [1, 0.08, 1]);
    if (shallows) {
      if (t.variant % 4 === 0) b.add('box', PALETTE.ground.seaFoam, [x + r.range(-0.3, 0.3), surf + 0.004, z + r.range(-0.3, 0.3)], [r.range(0.2, 0.45), 0.006, 0.05]);
      return;
    }
    if (t.ground === 'polluted') return; // a dried-out, silted bed: the painted silt does the rest
    if (t.ground !== 'restored') return;
    // clear water (its surface is `poolSurface`): lily pads, and lotus flowers as it blooms. As a pond drains they
    // ride down with it: none where its bed now shows (E23.4.1).
    if (!this.sim.water.covered(t)) return;
    const pads = (t.variant % 3) + (t.bloom >= 3 ? 1 : 0);
    for (let i = 0; i < pads; i++) {
      const px = x + r.range(-0.28, 0.28);
      const pz = z + r.range(-0.28, 0.28);
      b.add('cylinder', i % 2 ? PALETTE.leaf.dark : PALETTE.leaf.mid, [px, surf + 0.012, pz], [0.2, 0.012, 0.2]);
      if (t.bloom >= 2 && i === 0) {
        b.add('sphere', PALETTE.flowers.blush, [px, surf + 0.05, pz], [0.13, 0.07, 0.13]);
        b.add('sphere', PALETTE.flowers.core, [px, surf + 0.075, pz], 0.045);
      }
    }
  }

  /** The radius of the rounded bank in each corner of a pool tile (0: none), in CORNERS order. */
  private poolCorners(t: TileData): number[] {
    const g = this.sim.grid;
    const water = (dx: number, dz: number) => {
      const n = g.peek(t.roofId, t.x + dx, t.z + dz);
      return !n || this.bankless(n);
    };
    return CORNERS.map(([sx, sz]) => (water(sx, 0) || water(0, sz) ? 0 : water(-sx, 0) && water(0, -sz) && water(-sx, -sz) ? WATER.wide : WATER.fillet));
  }

  /**
   * Clean water's surface for one tile: a fine grid just above the bed, coloured from pale shallows at the bank to
   * deep blue in the middle, with the distance to the bank in the vertex alpha (the pool shader draws the foam
   * line, caustics and ripples from it).
   */
  private poolSurface(out: PoolGeo, t: TileData, h: number) {
    const g = this.sim.grid;
    const y = h + 0.08 - WATER.drop + 0.003;
    const land: [number, number][] = [];
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const n = g.peek(t.roofId, t.x + dx, t.z + dz);
        if (n && !this.isWater(n)) land.push([t.x + dx, t.z + dz]);
      }
    const radius = this.poolCorners(t);
    const shallow = lin(PALETTE.aqua.foam);
    const mid = lin(PALETTE.aqua.water);
    const deep = lin(PALETTE.aqua.deep);
    const N = WATER.grid;
    const base = out.pos.length / 3;
    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++) {
        const px = t.x + i / N;
        const pz = t.z + j / N;
        let d = WATER.deepAt;
        for (const [lx, lz] of land) d = Math.min(d, Math.hypot(Math.max(lx - px, 0, px - lx - 1), Math.max(lz - pz, 0, pz - lz - 1)));
        for (let c = 0; c < 4; c++) {
          const R = radius[c];
          if (!R) continue;
          const [sx, sz] = CORNERS[c];
          const vx = (px - (t.x + 0.5 + sx * (0.5 - R))) * sx;
          const vz = (pz - (t.z + 0.5 + sz * (0.5 - R))) * sz;
          if (vx > 0 && vz > 0) d = Math.min(d, Math.max(0, R - Math.hypot(vx, vz)));
        }
        const k = Math.min(1, d / WATER.deepAt);
        // pale at the bank, the water's own blue a third of the way in, deepening to the middle
        const a = Math.min(1, k / 0.3);
        const e = Math.max(0, (k - 0.3) / 0.7) * 0.75;
        out.pos.push(px, y, pz);
        for (let q = 0; q < 3; q++) out.col.push(Math.round((shallow[q] + (mid[q] - shallow[q]) * a + (deep[q] - mid[q]) * e) * 255));
        out.col.push(Math.round(k * 255));
      }
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const a = base + j * (N + 1) + i;
        out.idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
      }
  }

  private poolMesh(geo: PoolGeo): pc.Mesh | undefined {
    if (!geo.idx.length) return undefined;
    const m = new pc.Mesh(this.device);
    const nrm: number[] = [];
    for (let i = 0; i < geo.pos.length; i += 3) nrm.push(0, 1, 0);
    m.setPositions(geo.pos);
    m.setNormals(nrm);
    m.setColors32(geo.col);
    m.setIndices(geo.idx);
    m.update(pc.PRIMITIVE_TRIANGLES);
    return m;
  }

  /**
   * A pool tile's banks (static mesh): a wall in the neighbouring tile's material on every land side, and a rounded
   * bank of that material in each outer corner, wider where the pool carries on behind the tile, with the odd rock
   * or clump of reeds on it.
   */
  private poolBanks(b: MeshBuilder, t: TileData, h: number, gtex?: GroundTexGeo[]) {
    const g = this.sim.grid;
    const x = t.x + 0.5;
    const z = t.z + 0.5;
    const top = h + 0.08;
    const foot = top - WATER.drop - 0.02;
    const keep = b.grey;
    // a land neighbour (one not generated yet counts as water: canals run on across chunks)
    const side = (dx: number, dz: number) => {
      const n = g.peek(t.roofId, t.x + dx, t.z + dz);
      return n && !this.bankless(n) ? n : undefined;
    };
    const radius = this.poolCorners(t);
    for (let i = 0; i < 4; i++) {
      const [sx, sz] = CORNERS[i];
      const nx = side(sx, 0);
      const nz = side(0, sz);
      const R = radius[i];
      if (!R || !nx || !nz) continue;
      // the rounded bank takes the material of the tile across the corner (or of a side, if that one is water)
      const land = side(sx, sz) ?? nx;
      b.grey = this.greyOf(land);
      const cx = x + sx * 0.5;
      const cz = z + sz * 0.5;
      // the bank carries on the land's painted ground (and stands as high as raised paving does)
      const lgt = gtex ? this.paintedTop(land) : undefined;
      const bankTop = top + (this.raisedPaving(land) ? PAVING_RAISE.lift : 0);
      b.prism(lgt === 'dead-paving' ? PALETTE.ground.pavingKerb : this.topColour(land), [cx, cz], this.arc(cx, cz, sx, sz, R), false, bankTop, foot);
      if (lgt) {
        const k = Math.round(255 * (1 - 0.3 * b.grey));
        addGroundFan(gtex![GROUND_TEXTURES.indexOf(lgt)], lgt, [cx, cz], this.arc(cx, cz, sx, sz, R), bankTop + 0.006, [k, k, k]);
      }
      b.grey = keep;
      const k = hash01(t.x * 2 + sx, t.z * 2 + sz, 91);
      const px = cx - sx * R * 0.3;
      const pz = cz - sz * R * 0.3;
      const alive = this.poolAlive(t);
      if (k < 0.4) {
        b.add('sphere', PALETTE.stone.pebble, [px, top + 0.04, pz], [0.2, 0.14, 0.17]);
        b.add('sphere', PALETTE.stone.grey, [px + sx * 0.12, top + 0.03, pz - sz * 0.1], [0.13, 0.1, 0.12]);
        if (alive) b.add('sphere', PALETTE.leaf.light, [px, top + 0.09, pz], [0.14, 0.05, 0.12]);
      } else if (alive && k < 0.9)
        for (let j = 0; j < 3; j++) {
          const ht = 0.22 + 0.1 * j;
          const rx = px + (j - 1) * 0.06;
          const rz = pz + (j === 1 ? 0.05 : -0.03);
          b.add('cone', [PALETTE.leaf.dark, PALETTE.leaf.mid, PALETTE.leaf.deep][j], [rx, top + ht / 2, rz], [0.05, ht, 0.05]);
          if (j === 2 && t.bloom >= 2) b.add('capsule', PALETTE.wood.bark, [rx, top + ht, rz], [0.045, 0.05, 0.045]); // a bulrush
        }
    }
    // straight banks, stopping where a rounded corner takes over
    for (const [dx, dz] of EDGE_DIRS) {
      const n = side(dx, dz);
      if (!n) continue;
      // a boulder or a stand of reeds at the water's edge, here and there
      const k = hash01(t.x * 2 + dx, t.z * 2 + dz, 93);
      const along = (hash01(t.x + dx, t.z + dz, 94) - 0.5) * 0.5;
      const ex0 = x + dx * 0.4 + (dz ? along : 0);
      const ez0 = z + dz * 0.4 + (dx ? along : 0);
      const surf = top - WATER.drop;
      b.grey = keep;
      if (k < 0.3) {
        b.add('sphere', k < 0.15 ? PALETTE.stone.pebble : PALETTE.stone.grey, [ex0, surf + 0.05, ez0], [0.24, 0.2, 0.2]);
        b.add('sphere', PALETTE.stone.warm, [ex0 + (dz ? 0.16 : 0), surf + 0.03, ez0 + (dx ? 0.16 : 0)], [0.14, 0.12, 0.13]);
        if (this.poolAlive(t)) b.add('sphere', PALETTE.leaf.light, [ex0, surf + 0.14, ez0], [0.15, 0.04, 0.12]);
      } else if (k < 0.5 && this.poolAlive(t))
        for (let j = 0; j < 4; j++) {
          const ht = 0.26 + 0.07 * j;
          const rx = ex0 + (dz ? (j - 1.5) * 0.07 : (j % 2) * 0.05);
          const rz = ez0 + (dx ? (j - 1.5) * 0.07 : (j % 2) * 0.05);
          b.add('cone', [PALETTE.leaf.dark, PALETTE.leaf.mid, PALETTE.leaf.deep, PALETTE.leaf.stalk][j], [rx, surf + ht / 2, rz], [0.045, ht, 0.045]);
          if (j === 3) b.add('capsule', PALETTE.wood.bark, [rx, surf + ht, rz], [0.04, 0.05, 0.04]);
        }
      b.grey = this.greyOf(n);
      const hex = this.topColour(n);
      // (and short of the land's own corner where that is rounded off into the water)
      const ncut = this.landCuts(n);
      const reach = [-1, 1].map((e) => 0.5 - Math.max(radius[CORNERS.findIndex((c) => c[0] === (dx || e) && c[1] === (dz || e))], ncut?.[CORNERS.findIndex((c) => c[0] === (dx ? -dx : e) && c[1] === (dz ? -dz : e))] ?? 0));
      const ex = x + dx * 0.497;
      const ez = z + dz * 0.497;
      const a: V3 = dx ? [ex, top, z - reach[0]] : [x - reach[0], top, ez];
      const c: V3 = dx ? [ex, top, z + reach[1]] : [x + reach[1], top, ez];
      const N: V3 = [-dx, 0, -dz];
      b.tri(hex, a, c, [c[0], foot, c[2]], N);
      b.tri(hex, a, [c[0], foot, c[2]], [a[0], foot, a[2]], N);
    }
    b.grey = keep;
  }

  // ───────────── flower canopies ─────────────

  /**
   * A pergola over a stretch of park path (posts on the path's edges, so every tile under it stays open). It
   * follows the park's stage: a weathered frame with a fallen post, then repaired and white with climbers, then
   * hanging wisteria, then full bloom with flowers along the top.
   */
  private pergola(b: MeshBuilder, fb: FoliageBuilder, p: { x: number; z: number; w: number; d: number }, y: number) {
    const L = this.level;
    const wood = L >= 2 ? PALETTE.stone.bright : PALETTE.stone.grey;
    const H = 1.25;
    const alongX = p.w >= p.d;
    const len = alongX ? p.w : p.d;
    const span = alongX ? p.d : p.w;
    // local (u along the path, v across it) → world
    const at = (u: number, v: number, yy: number): V3 => (alongX ? [p.x + u, yy, p.z + v] : [p.x + v, yy, p.z + u]);
    const box = (hex: string, u: number, v: number, yy: number, su: number, sy: number, sv: number) => b.add('box', hex, at(u, v, yy), alongX ? [su, sy, sv] : [sv, sy, su]);
    const r = new VRng(p.x * 131 + p.z * 17 + 5);
    for (const v of [0.06, span - 0.06]) {
      for (let u = 0; u <= len; u++) {
        const uu = Math.min(len - 0.06, Math.max(0.06, u));
        if (L < 2 && u === 1 && v > 1) {
          box(wood, uu + 0.4, v + 0.25, y + 0.05, 0.9, 0.09, 0.09); // a post lying where it fell
          continue;
        }
        b.add('box', L >= 2 ? PALETTE.stone.warm : PALETTE.stone.dark, at(uu, v, y + 0.06), [0.2, 0.12, 0.2]);
        b.add('cylinder', wood, at(uu, v, y + H / 2), [0.09, H, 0.09]);
      }
      if (L >= 2 || v < 1) box(wood, len / 2, v, y + H + 0.04, len + 0.3, 0.08, 0.09);
    }
    // rafters across the path
    const n = len * 2 + 1;
    for (let i = 0; i < n; i++) {
      if (L < 2 && i % 3 !== 0) continue;
      box(wood, (i / (n - 1)) * len, span / 2, y + H + 0.11, 0.06, 0.06, span + 0.3);
    }
    // Planting, from the same leaves and flowers as the rest of the park. A vine hangs from the edge it is given,
    // running along its local +x with its leaves facing +z: `turn` lays that along a side beam, facing outwards.
    const stage = L >= 4 ? 4 : L >= 3 ? 3 : L >= 2 ? 2 : 0;
    const vine = (u: number, outer: boolean, yy: number, hang: number, scale: number, variant: number) => {
      const turn = alongX ? (outer ? 0 : Math.PI) : outer ? -Math.PI / 2 : Math.PI / 2;
      const [wx, , wz] = at(alongX === outer ? u : u + scale, outer ? span + 0.02 : -0.02, 0);
      fb.add(vineGeo(stage, hang, variant, 1), wx, yy, wz, turn, scale);
    };
    for (const outer of [false, true]) {
      if (L < 2) {
        // dead strands on the old frame
        for (let u = 0; u < len; u += 2) vine(u, outer, y + H, 0.3, 1, p.x + u);
        continue;
      }
      // a fringe along each beam, longer as the park wakes, and a climber down each post
      for (let u = 0; u < len; u++) vine(u, outer, y + H + 0.02, 0.4 + 0.15 * (stage - 2) + r.range(0, 0.15), 1, p.x * 7 + u + (outer ? 11 : 0));
      for (let u = 0; u <= len; u++) vine(Math.min(len - 0.17, Math.max(-0.17, u - 0.17)), outer, y + H, 3.2, 0.34, p.z * 5 + u + (outer ? 3 : 0));
    }
    if (L < 2) return;
    // the roof: leafy shrubs along both beams (in flower from stage 3), then flowers standing among them
    for (let i = 0; i < len * 3; i++) {
      const u = (i + 0.5) / 3;
      for (const v of [0.04, span - 0.04]) {
        const [wx, wy, wz] = at(u + r.range(-0.08, 0.08), v, y + H + 0.08);
        fb.add(leafyShrubGeo(i + (v > 1 ? 3 : 0), 1, L >= 3 && i % 2 === 0), wx, wy, wz, r.range(0, 6.28), r.range(0.68, 0.86));
        if (L < 3) continue;
        const [fx, fy, fz] = at(u + 0.25, v + (v > 1 ? -0.1 : 0.1), y + H + 0.1);
        fb.add(flowerGeo('lavender', i % 2, true, i, 1), fx, fy, fz, i * 1.3, 0.95);
      }
    }
    if (L < 4) return;
    for (let i = 0; i < len * 2; i++) {
      const [wx, wy, wz] = at(r.range(0.2, len - 0.2), r.range(0.4, span - 0.4), y + H + 0.14);
      if (i % 3 === 0) fb.add(leafyShrubGeo(i + 1, 1, true), wx, wy, wz, i * 2.1, 0.6);
      else fb.add(flowerGeo(i % 2 ? 'cosmos' : 'daisy', i, true, i, 1), wx, wy, wz, i * 1.7, 0.9);
    }
  }

  /**
   * Phase 5 E16: a restored tile, by stage. Each stage reads differently at gameplay zoom:
   *  1 Restored: pale young grass, short tufts;
   *  2 Blooming: fresh green with two tight flower clusters of one colour each (patches of colour);
   *  3 Thriving: deep lush green; a tree, or a seeded mix of shrubs, tall flower spikes and mossy rocks;
   *  4 Radiant: the Thriving tile under a warm golden glow with luminous gold flowers.
   * Lawns get a darker trimmed edge where they meet paving, and paving a raised white border where it meets
   * lawn. All of it is low and inside the tile, so the grid and the restored/dead contrast stay readable.
   */
  private restoredTile(b: Sink, t: TileData, h: number, x: number, z: number, top: number, f: string, r: VRng) {
    void r;
    const stage = Math.max(1, Math.min(4, this.sim.water.bloomShown(t) || 1)); // E23.4.4: fades by low water
    const grass = grassTone(stage, t.x, t.z);
    const c = this.ctx;
    if (f === 'paving') {
      // Look 3.2: clean stone slabs, moss and tiny flowers in the gaps; a street tree stands in a stone planter.
      paving(c, t, true, x, z, h);
      if (treeSpot(t, this.areaType)?.planter) planterBed(c, t, true, x, z, top, 0.62, 0.62);
      this.edges(b, t, x, z, top, true);
    } else if (f === 'road') {
      // Look 2.5: a restored road keeps its surface (cleaner), with greenery creeping in from the edges.
      const piece = this.roads?.pieceAt(t.x, t.z);
      b.add('box', piece?.tier === 'arterial' ? PALETTE.paving.arterialAlive : PALETTE.paving.roadAlive, [x, h, z], [1, 0.16, 1]);
      if (piece) this.roadMarks(b, piece, t, x, z, top, true);
      else if (t.variant % 3 === 0) b.add('box', PALETTE.paving.roadLine, [x, top + 0.004, z], [0.12, 0.01, 0.4]);
      for (const [dx, dz] of EDGE_DIRS) {
        const n = this.sim.grid.peek(t.roofId, t.x + dx, t.z + dz);
        if (!n || (n.feature ?? 'lawn') === 'road') continue;
        b.add('box', grass, [x + dx * 0.43, top + 0.004, z + dz * 0.43], [dx ? 0.14 : 1, 0.012, dz ? 0.14 : 1]);
        for (let i = 0; i < 2; i++) {
          const along = r.range(-0.42, 0.42);
          b.tip = PALETTE.lawn.tuftTip[i];
          b.add('cone', PALETTE.lawn.tuft[i], this.at(x + (dx ? dx * 0.42 : along), top + 0.05, z + (dz ? dz * 0.42 : along), 0.025), [0.05, 0.1, 0.05]);
          b.tip = '';
        }
      }
      return;
    } else {
      this.slab(b, grass, [x, h, z], [1, 0.16, 1]);
      turfTop(c, t, top); // Look 3.3: corner-blended turf, no square seams between lawns
      this.edges(b, t, x, z, top, false);
      // Look 3.9: some reservoir clay becomes a raised bed
      if (f === 'clay' && stage >= 2 && dhash(t.x, t.z, 221) < 0.25 && !treeSpot(t, this.areaType)) {
        planterBed(c, t, true, x, z, top, 0.9, 0.9);
        return;
      }
    }
    grassTufts(c, t, stage, x, z, top, f === 'paving' ? 0.2 : 0.46, f === 'paving' ? 1 : undefined);
    if (f !== 'paving') flowerDrifts(c, t, stage, x, z, top); // Look 3.4/3.5: species drifts hugging edges
    if (t.plant && f !== 'paving') this.plantExtras(t, x, z, top); // E23.2.2: what a loaded pulse grew
    // Phase 5: a tree tile grows its tree from a sapling (Restored) to Radiant; other Thriving tiles get a seeded mix.
    if (!this.addTree(t, h, 1) && stage >= 3 && f !== 'paving') thrivingExtras(c, t, x, z, top);
    else if (stage <= 2 && f !== 'paving' && !treeSpot(t, this.areaType) && dhash(t.x, t.z, 67) < 0.07) {
      // the odd pebble in young lawns (seeded), so open lawn doesn't repeat exactly
      b.add('sphere', PALETTE.stone.pebble, this.at(x + (dhash(t.x, t.z, 68) - 0.5) * 0.6, top + 0.03, z + (dhash(t.x, t.z, 69) - 0.5) * 0.6, 0.08), [0.16, 0.08, 0.13]);
    }
    if (stage >= 4) radiantExtras(c, t, x, z, top); // Phase 4 E05: Radiant gold, now golden daisies and sunflowers
  }

  /**
   * E23.2.2.2: what a loaded pulse grew. A wildflower meadow (seeds) is a scatter of mixed wildflowers; a rare seed
   * grows its region's own flower, taller and denser; fertiliser grows a young tree (unless the tile already has
   * one) in a ring of flowering shrubs. Seeded per tile, so a chunk rebuild draws the same plants.
   */
  private plantExtras(t: TileData, x: number, z: number, top: number) {
    const fb = this.scatter;
    const at = (i: number, salt: number) => [x + (dhash(t.x, t.z, salt + i * 7) - 0.5) * 0.78, z + (dhash(t.x, t.z, salt + i * 7 + 3) - 0.5) * 0.78] as const;
    if (t.plant === 'meadow') {
      const mix = ['daisy', 'cosmos', 'wild', 'lavender'] as const;
      for (let i = 0; i < 7; i++) {
        const [px, pz] = at(i, 901);
        fb.add(flowerGeo(mix[(t.variant + i) % mix.length], i, true, t.variant + i, 1), px, top, pz, i * 1.9, 0.85 + dhash(t.x, t.z, 950 + i) * 0.3);
      }
    } else if (t.plant === 'rare') {
      const rp = RARE_PLANTS[this.sim.areas.areaOf(t) ?? ''] ?? RARE_PLANT_DEFAULT;
      for (let i = 0; i < 9; i++) {
        const [px, pz] = at(i, 911);
        fb.add(tintGeo(flowerGeo(rp.flower, i, true, t.variant + i * 3, 1), rp.tint), px, top, pz, i * 2.3, rp.height * (0.95 + dhash(t.x, t.z, 960 + i) * 0.3));
      }
      fb.add(leafyShrubGeo(t.variant, 1, true), x, top, z, t.variant, 0.55);
    } else if (t.plant === 'grove') {
      if (!treeSpot(t, this.areaType)) {
        const kinds = ['oak', 'cherry', 'birch'] as const;
        fb.add(treeGeo(kinds[t.variant % kinds.length], 3, t.variant, 1), x + (dhash(t.x, t.z, 921) - 0.5) * 0.2, top, z + (dhash(t.x, t.z, 922) - 0.5) * 0.2, t.variant * 0.7, 0.55);
      }
      for (let i = 0; i < 3; i++) {
        const [px, pz] = at(i, 931);
        fb.add(leafyShrubGeo(t.variant + i, 1, true), px, top, pz, i * 2.1, 0.5);
      }
    }
  }

  /**
   * Phase 5 E16: where restored lawn meets restored paving, the lawn gets a trimmed darker edge and the paving a
   * raised white border (only on that side; neighbours in chunks not generated yet are skipped).
   */
  private edges(b: Sink, t: TileData, x: number, z: number, top: number, paving: boolean) {
    for (const [dx, dz] of EDGE_DIRS) {
      const n = this.sim.grid.peek(t.roofId, t.x + dx, t.z + dz);
      if (!n || n.ground !== 'restored' || n.blocked || n.occupantId) continue;
      const nf = n.feature ?? 'lawn';
      if (paving ? nf !== 'lawn' : nf !== 'paving') continue;
      const ex = x + dx * (paving ? 0.455 : 0.47);
      const ez = z + dz * (paving ? 0.455 : 0.47);
      const sx = dx ? (paving ? 0.07 : 0.05) : 0.98;
      const sz = dz ? (paving ? 0.07 : 0.05) : 0.98;
      if (paving) b.add('box', PALETTE.stone.bright, [ex, top + 0.015, ez], [sx, 0.05, sz]);
      else b.add('box', PALETTE.lawn.edge, [ex, top - 0.02, ez], [sx, 0.03, sz]);
    }
  }

  /** Small props on obstacle tiles (benches, stalls, stumps…). */
  /** A skyscraper built into meshes of its own (walls and planting), so it can fade without touching its chunk. */
  private tower(p: BuildingPlot, h: number, alive: boolean, grey: number): Tower {
    const b = new MeshBuilder();
    const fb = new FoliageBuilder();
    b.grey = fb.grey = grey;
    const keep = { fb: this.fb, sink: this.sink };
    this.fb = fb;
    this.sink = b;
    this.building(b, p, h, alive, false);
    this.fb = keep.fb;
    this.sink = keep.sink;
    const t: Tower = { x: p.x + p.w / 2, z: p.z + p.d / 2, base: h + 0.08, top: h + 0.08 + p.storeys * CITY_GEN.buildings.storey, r: Math.max(p.w, p.d) / 2, entities: [], mis: [], a: 1, to: 1 };
    const parts: [pc.Mesh | undefined, pc.Material][] = [[b.build(this.device), towerMaterial()], [fb.build(this.device), foliageMaterial()]];
    for (const [mesh, material] of parts) {
      if (!mesh) continue;
      const mi = new pc.MeshInstance(mesh, material);
      const e = new pc.Entity('tower');
      e.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: true });
      this.root.addChild(e);
      t.entities.push(e);
      t.mis.push(mi);
    }
    return t;
  }

  /**
   * See-through skyscrapers. `points` are screen positions (pixels) to keep in view, each with the view depth of the
   * ground there: the cursor and the middle of the view. A tower standing in front of one fades to a ghost; it
   * comes back when it no longer covers any. Called once per frame.
   */
  fadeTowers(dt: number, cam: pc.CameraComponent, points: { x: number; y: number; depth: number }[], through?: pc.Vec3) {
    const eye = cam.entity.getPosition();
    const fwd = cam.entity.forward;
    const a = new pc.Vec3();
    const c = new pc.Vec3();
    const k = Math.min(1, dt * TOWER_FADE.speed);
    for (const v of this.views.values()) {
      if (!v.towers) continue;
      for (const t of v.towers) {
        let cover = false;
        const depth = (t.x - eye.x) * fwd.x + (t.base - eye.y) * fwd.y + (t.z - eye.z) * fwd.z;
        if (points.length && depth > 0.2) {
          cam.worldToScreen(new pc.Vec3(t.x, t.base, t.z), a);
          cam.worldToScreen(new pc.Vec3(t.x, t.top, t.z), c);
          const sx = c.x - a.x;
          const sy = c.y - a.y;
          const len = Math.max(1, Math.hypot(sx, sy));
          // its half width on screen, from its height on screen (plus a little, so the edge doesn't flicker)
          const half = (t.r / (t.top - t.base)) * len * 1.25;
          for (const p of points) {
            if (p.depth < depth + t.r + 0.5) continue; // the point is in front of the tower (or on it)
            const u = Math.min(1, Math.max(0, ((p.x - a.x) * sx + (p.y - a.y) * sy) / (len * len)));
            if (Math.hypot(p.x - (a.x + sx * u), p.y - (a.y + sy * u)) < half) cover = true;
          }
        }
        // E21.22: anything standing between the camera and bloombot fades (a world-space test of the sight line)
        if (!cover && through && blocksSight(eye, through, t)) cover = true;
        t.to = cover ? this.fadeTo : 1;
        if (Math.abs(t.to - t.a) < 0.004) {
          if (t.a === t.to) continue;
          t.a = t.to;
        } else t.a += (t.to - t.a) * k;
        for (const mi of t.mis) mi.setParameter('material_opacity', t.a);
      }
    }
  }

  /**
   * A real city building, by its height: a house (one or two storeys: pitched tile roof, chimney, door), a town
   * block (flat roof that blooms when clear), or a skyscraper (six storeys and up: a podium, a glass shaft and a
   * set-back crown, with planted terraces on the ledges once the area is clear).
   */
  private building(b: MeshBuilder, p: BuildingPlot, h: number, alive: boolean, far = false) {
    const S = CITY_GEN.buildings.storey;
    const base = h + 0.08;
    const cx = p.x + p.w / 2;
    const cz = p.z + p.d / 2;
    const bw = p.w - 0.25;
    const bd = p.d - 0.25;
    const wall = (alive ? PALETTE.building.wallsAlive : PALETTE.building.wallsDead)[p.style % 5];
    const glass = alive ? PALETTE.building.glassAlive : PALETTE.building.glassDead;
    if (p.storeys >= 6) return this.skyscraper(b, p, base, wall, glass, alive, far);
    const H = p.storeys * S;
    const top = base + H;
    b.add('box', wall, [cx, base + H / 2, cz], [bw, H, bd]);
    const house = p.storeys <= 2;
    if (house) this.gable(b, p, top, wall, alive);
    if (far) {
      if (!house) b.add('box', alive ? PALETTE.building.roofGarden : PALETTE.building.roofDead, [cx, top + 0.03, cz], [bw * 0.9, 0.06, bd * 0.9]);
      return;
    }
    const south = p.z + p.d - 0.12 + 0.005;
    const east = p.x + p.w - 0.12 + 0.005;
    if (house) {
      // A door and a window or two per storey on the two faces the camera sees.
      const door = alive ? PALETTE.woodPlank : PALETTE.woodDead;
      b.add('box', door, [cx - bw * 0.22, base + 0.15, south], [0.2, 0.3, 0.03]);
      b.add('box', alive ? PALETTE.building.parapetAlive : PALETTE.building.parapetDead, [cx - bw * 0.22, base + 0.015, south + 0.07], [0.34, 0.03, 0.14]); // doorstep
      const eastN = Math.max(1, Math.floor(bd));
      for (let i = 0; i < p.storeys; i++) {
        const y = base + S * (i + 0.58);
        b.add('box', glass, [cx + bw * 0.2, y, south], [0.24, S * 0.42, 0.02]);
        if (i > 0) b.add('box', glass, [cx - bw * 0.22, y, south], [0.24, S * 0.42, 0.02]);
        for (let k = 0; k < eastN; k++) b.add('box', glass, [east, y, p.z + 0.125 + (k + 0.5) * (bd / eastN)], [0.02, S * 0.42, 0.24]);
      }
      if (alive) {
        // a window box in flower, and a shrub by the door
        const wy = base + S * 0.34;
        b.add('box', PALETTE.terracotta, [cx + bw * 0.2, wy, south + 0.04], [0.3, 0.05, 0.08]);
        this.fb.grey = b.grey;
        this.fb.add(flowerGeo(p.style % 2 ? 'cosmos' : 'daisy', p.style, true, p.x + p.z, 1), cx + bw * 0.2, wy + 0.02, south + 0.04, p.style, 0.55);
        this.fb.add(leafyShrubGeo(p.style, 1, p.style % 2 === 0), cx - bw * 0.22 - 0.3, base, south + 0.14, p.style * 1.3, 0.5);
      }
      buildingDressing(this.ctx, p, h, H, alive);
      return;
    }
    // Window bands on the two faces the camera sees (south and east), one per storey.
    for (let i = 0; i < p.storeys; i++) {
      const y = base + S * (i + 0.55);
      b.add('box', glass, [cx, y, south], [bw * 0.82, S * 0.38, 0.02]);
      b.add('box', glass, [east, y, cz], [0.02, S * 0.38, bd * 0.82]);
    }
    // Parapet and roof.
    b.add('box', alive ? PALETTE.building.parapetAlive : PALETTE.stone.shadow, [cx, top + 0.04, cz], [bw + 0.06, 0.08, bd + 0.06]);
    if (alive) {
      // A roof garden, a solar panel or two, and vines down the sunny face.
      b.add('box', PALETTE.building.gardenBed, [cx, top + 0.09, cz], [bw * 0.86, 0.05, bd * 0.86]);
      const r = new VRng(p.style * 131 + p.x * 7 + p.z * 13);
      for (let i = 0; i < 1 + (p.style % 2); i++) b.add('box', PALETTE.panel, [p.x + 0.6 + i * 0.7, top + 0.2, p.z + 0.6], [0.5, 0.04, 0.4]);
      this.fb.grey = b.grey;
      for (let i = 0; i < 3; i++) this.fb.add(leafyShrubGeo(p.style + i, 1, i % 2 === 0), p.x + r.range(0.5, p.w - 0.5), top + 0.1, p.z + r.range(0.9, p.d - 0.4), r.range(0, 6.28), r.range(0.5, 0.7));
    } else {
      // A rusty water tank or a dead antenna on the roof.
      if (p.style % 3 === 0) b.add('cylinder', PALETTE.building.tank, [p.x + 0.6, top + 0.3, p.z + 0.6], [0.4, 0.45, 0.4]);
      else b.add('box', PALETTE.paving.crack, [p.x + p.w - 0.5, top + 0.4, p.z + 0.5], [0.04, 0.7, 0.04]);
    }
    buildingDressing(this.ctx, p, h, H, alive); // Look 3.8/3.11: ivy down the facades, wall clutter
  }

  /** A house's pitched roof: two tiled slopes off a ridge along the longer side, gable ends in the wall colour, a chimney. */
  private gable(b: MeshBuilder, p: BuildingPlot, y0: number, wall: string, alive: boolean) {
    const cx = p.x + p.w / 2;
    const cz = p.z + p.d / 2;
    const bw = p.w - 0.25;
    const bd = p.d - 0.25;
    const alongX = bw >= bd;
    const half = (alongX ? bd : bw) / 2;
    const len = (alongX ? bw : bd) / 2;
    const eave = 0.1;
    const rise = half * 0.8;
    const y1 = y0 + rise;
    const ye = y0 - (eave * rise) / half; // the eaves hang a little past the wall, a little lower
    const tiles = p.style % 3 === 1 ? (alive ? PALETTE.metal.slate : PALETTE.building.roofDead) : alive ? PALETTE.terracotta : PALETTE.terracottaDead;
    // along = the ridge axis, across = the slope axis
    const P = (along: number, y: number, across: number): V3 => (alongX ? [cx + along, y, cz + across] : [cx + across, y, cz + along]);
    const N = (along: number, y: number, across: number): V3 => (alongX ? [along, y, across] : [across, y, along]);
    const nl = Math.hypot(rise, half);
    for (const side of [-1, 1]) {
      const n = N(0, half / nl, (side * rise) / nl);
      const a = P(-len, ye, side * (half + eave));
      const c = P(len, ye, side * (half + eave));
      b.tri(tiles, a, c, P(len, y1, 0), n);
      b.tri(tiles, a, P(len, y1, 0), P(-len, y1, 0), n);
      b.tri(wall, P(side * len, y0, -half), P(side * len, y0, half), P(side * len, y1, 0), N(side, 0, 0));
    }
    b.add('box', alive ? PALETTE.bricks[p.style % 3] : PALETTE.building.tank, P(len * 0.45, y0 + rise * 0.75, half * 0.4), [0.16, rise * 0.9, 0.16]);
  }

  /**
   * A skyscraper: a two-storey podium over the whole plot, a glass shaft set in from it, and a narrower crown, each
   * with window bands on the faces the camera sees. Clear, its ledges and roof are planted terraces with solar
   * panels and a mast; in the fog it is a dark shell with a dead antenna.
   */
  private skyscraper(b: MeshBuilder, p: BuildingPlot, base: number, wall: string, glass: string, alive: boolean, far: boolean) {
    const S = CITY_GEN.buildings.storey;
    const cx = p.x + p.w / 2;
    const cz = p.z + p.d / 2;
    const bw = p.w - 0.25;
    const bd = p.d - 0.25;
    const n = p.storeys;
    const crownFrom = Math.max(4, Math.round(n * 0.72));
    // tiers: [first storey, storeys, footprint scale]
    const tiers: [number, number, number][] = [[0, 2, 1], [2, crownFrom - 2, 0.84], [crownFrom, n - crownFrom, 0.62]];
    const trim = alive ? PALETTE.building.parapetAlive : PALETTE.stone.shadow;
    const r = new VRng(p.style * 131 + p.x * 7 + p.z * 13);
    if (!far) this.fb.grey = b.grey;
    tiers.forEach(([from, count, k], ti) => {
      if (count <= 0) return;
      const w = bw * k;
      const d = bd * k;
      const y0 = base + from * S;
      const H = count * S;
      b.add('box', wall, [cx, y0 + H / 2, cz], [w, H, d]);
      const last = ti === tiers.length - 1 || tiers[ti + 1][1] <= 0;
      if (far) {
        b.add('box', glass, [cx, y0 + H / 2, cz + d / 2 + 0.004], [w * 0.84, H * 0.86, 0.01]);
        b.add('box', glass, [cx + w / 2 + 0.004, y0 + H / 2, cz], [0.01, H * 0.86, d * 0.84]);
        if (last) b.add('box', alive ? PALETTE.building.roofGarden : PALETTE.building.roofDead, [cx, y0 + H + 0.03, cz], [w * 0.9, 0.06, d * 0.9]);
        return;
      }
      for (let i = 0; i < count; i++) {
        const y = y0 + S * (i + 0.55);
        const tall = ti === 0 && i === 0 ? 0.62 : 0.5; // a glazed ground floor
        b.add('box', glass, [cx, y, cz + d / 2 + 0.005], [w * 0.86, S * tall, 0.02]);
        b.add('box', glass, [cx + w / 2 + 0.005, y, cz], [0.02, S * tall, d * 0.86]);
      }
      // corner piers up the faces the camera sees, and a ledge on top of the tier
      for (const [px, pz] of [[w / 2, d / 2], [-w / 2, d / 2], [w / 2, -d / 2]]) b.add('box', trim, [cx + px, y0 + H / 2, cz + pz], [0.09, H, 0.09]);
      b.add('box', trim, [cx, y0 + H + 0.035, cz], [w + 0.08, 0.07, d + 0.08]);
      if (alive) {
        // a planted terrace on the ledge (the roof, for the crown)
        b.add('box', PALETTE.building.gardenBed, [cx, y0 + H + 0.08, cz], [w * 0.92, 0.04, d * 0.92]);
        for (let i = 0; i < (last ? 3 : 4); i++) {
          // on the crown anywhere on the roof; lower down along the south and east ledges
          const u = r.range(-0.42, 0.42);
          const sx = last ? u * w : i % 2 ? w * 0.46 : u * w;
          const sz = last ? r.range(-0.4, 0.4) * d : i % 2 ? u * d : d * 0.46;
          this.fb.add(leafyShrubGeo(p.style + i + ti * 3, 1, i % 2 === 0), cx + sx, y0 + H + 0.09, cz + sz, r.range(0, 6.28), r.range(0.45, 0.65));
        }
        if (!last) for (let i = 0; i < Math.floor(w); i++) if (r.next() < 0.7) this.fb.add(vineGeo(4, S * r.range(0.9, 1.8), p.x + i + ti, 1), cx - w / 2 + 0.3 + i, y0 + H + 0.06, cz + d / 2 + 0.05, 0, 1);
      }
      if (last) {
        const top = y0 + H + 0.07;
        if (alive) {
          b.add('box', PALETTE.panel, [cx - w * 0.2, top + 0.14, cz - d * 0.2], [Math.min(0.6, w * 0.4), 0.04, Math.min(0.45, d * 0.35)]);
          b.add('box', trim, [cx + w * 0.25, top + 0.45, cz - d * 0.25], [0.05, 0.9, 0.05]);
          b.add('box', PALETTE.glow.lamp, [cx + w * 0.25, top + 0.92, cz - d * 0.25], 0.09, 0.8);
        } else {
          b.add('cylinder', PALETTE.building.tank, [cx - w * 0.2, top + 0.2, cz - d * 0.2], [0.34, 0.4, 0.34]);
          b.add('box', PALETTE.paving.crack, [cx + w * 0.25, top + 0.4, cz - d * 0.25], [0.04, 0.8, 0.04]);
        }
      }
    });
    if (!far) buildingDressing(this.ctx, p, base - 0.08, 2 * S, alive); // ivy off the podium ledge, clutter at street level
  }

  /**
   * Look 4.9: the face of the raised city where it drops to a sunk neighbour chunk (side dx, dz). For the low
   * street-level step, a stone kerb. For a tall drop (TALL_DROP or more): a retaining wall with a plinth, two storeys of windows, pilasters, balconies with
   * planters, vines, and a coping with a low rail along the top edge. Only the sides the camera sees (east and
   * south) get the detail; the far sides are plain walls.
   */
  private facade(b: MeshBuilder, v: ChunkView, dx: number, dz: number, top: number, alive: boolean, far: boolean) {
    const N = CHUNK;
    const x0 = v.cx * N;
    const z0 = v.cz * N;
    const bottom = top - SINK - 0.4;
    const H = top + 0.08 - bottom;
    // Wall centre line, flush with the chunk edge; `along` runs the edge, `out` points down the drop.
    const ex = dx > 0 ? x0 + N : dx < 0 ? x0 : x0 + N / 2;
    const ez = dz > 0 ? z0 + N : dz < 0 ? z0 : z0 + N / 2;
    const alongX = dz !== 0;
    const at = (a: number, o: number, y: number): [number, number, number] => (alongX ? [x0 + a, y, ez + dz * o] : [ex + dx * o, y, z0 + a]);
    /** (along the edge, out from the wall, height) */
    const size = (a: number, o: number, y: number): [number, number, number] => (alongX ? [a, y, o] : [o, y, a]);
    const F = PALETTE.retaining;
    const pick = (c: readonly string[]) => (alive ? c[0] : c[1]);
    const stone = pick(F.stone);
    b.add('box', stone, at(N / 2, -0.2, bottom + H / 2), size(N, 0.4, H));
    if (far) return;
    const seen = dx > 0 || dz > 0;
    if (SINK < TALL_DROP) {
      // A street-level step: a stone kerb with a coping (Look 3 places railings, hedges and clutter along it).
      b.add('box', pick(F.coping), at(N / 2, 0.02, top + 0.1), size(N, 0.14, 0.08));
      if (seen) b.add('box', pick(F.plinth), at(N / 2, 0.02, bottom + 0.25), size(N, 0.04, 0.5));
      return;
    }
    // Coping and a low rail along the top edge (all sides: it outlines the terrace).
    b.add('box', pick(F.coping), at(N / 2, 0.02, top + 0.11), size(N, 0.12, 0.08));
    for (let a = 0.5; a < N; a += 2) b.add('box', F.rail, at(a, 0.02, top + 0.3), size(0.05, 0.05, 0.36));
    b.add('box', F.rail, at(N / 2, 0.02, top + 0.47), size(N, 0.04, 0.05));
    if (!seen) return;
    const glass = pick(F.glass);
    const r = new VRng(v.cx * 7919 + v.cz * 104729 + dx * 13 + dz * 31);
    // Plinth band and a darker foot.
    b.add('box', pick(F.plinth), at(N / 2, 0.02, bottom + 0.35), size(N, 0.06, 0.7));
    const storey = (SINK - 0.3) / 2;
    for (let f = 0; f < 2; f++) {
      const y = bottom + 0.7 + storey * (f + 0.5);
      for (let a = 1; a < N; a += 2) {
        if (r.next() < 0.12) continue; // a blank bay now and then
        b.add('box', glass, at(a, 0.015, y), size(1.05, 0.03, storey * 0.5));
        b.add('box', pick(F.sill), at(a, 0.03, y - storey * 0.3), size(1.25, 0.08, 0.06)); // sill
      }
      // Cornice between the storeys.
      b.add('box', pick(F.cornice), at(N / 2, 0.04, bottom + 0.7 + storey * (f + 1) - 0.05), size(N, 0.1, 0.08));
    }
    // Pilasters.
    for (let a = 0; a <= N; a += 4) b.add('box', pick(F.pilaster), at(a, 0.05, bottom + H / 2), size(0.3, 0.1, H));
    // Balconies with planters on the upper storey, and vines down the wall once the area is alive.
    const yb = bottom + 0.7 + storey;
    for (let a = 2; a < N; a += 4) {
      if (r.next() < 0.3) continue;
      b.add('box', pick(F.balcony), at(a, 0.28, yb), size(1.6, 0.5, 0.08));
      b.add('box', F.rail, at(a, 0.52, yb + 0.22), size(1.6, 0.04, 0.03));
      if (alive) for (let k = 0; k < 3; k++) b.add('sphere', k % 2 ? PALETTE.flower[(a + k) % PALETTE.flower.length] : PALETTE.shrub[k % 3], at(a - 0.5 + k * 0.5, 0.3, yb + 0.12), [0.26, 0.2, 0.26]);
    }
    if (alive)
      for (let i = 0; i < 4; i++) {
        const a = r.range(0.6, N - 0.6);
        const len = r.range(0.8, H * 0.8);
        b.add('box', F.vine[i % 2 ? 0 : 1], at(a, 0.07, top - len / 2), size(0.22, 0.04, len));
      }
  }

  /** A tree in a stone planter: bare twigs until it leafs out. */
  private planterTree(b: Sink, x: number, y: number, z: number, leafy: boolean) {
    b.add('box', leafy ? PALETTE.stone.warm : PALETTE.props.planterDead, [x, y + 0.09, z], [0.26, 0.18, 0.26]);
    if (leafy) this.fb.add(treeGeo('cherry', 2, 1, 1), x, y + 0.18, z, 0.7, 0.55); // Phase 5: a real little tree
    else {
      b.add('cylinder', PALETTE.trunk, [x, y + 0.36, z], [0.04, 0.4, 0.04]);
      b.add('box', PALETTE.wood.bark, [x + 0.05, y + 0.58, z], [0.14, 0.02, 0.02]);
      b.add('box', PALETTE.wood.bark, [x - 0.04, y + 0.52, z + 0.03], [0.02, 0.02, 0.12]);
    }
  }

  /** E23.2.3: an old park bench that has not been mended yet. */
  private brokenBench(x: number, z: number): boolean {
    const bx = Math.floor(x);
    const bz = Math.floor(z);
    return !this.sim.rest.usable({ id: `bench:${bx}:${bz}`, x: bx, z: bz, kind: 'old', facing: 0 });
  }

  /**
   * E23.2.3: what makes an old bench read as broken, over its sunken model: a seat slat fallen out onto the ground
   * in front, a snapped-off foot lying by one end, moss on the seat and the back rail, and rust on the iron ends.
   * Mending it (Rest.mend touches the tile) redraws it whole.
   */
  private benchDamage(b: Sink, x: number, y: number, z: number) {
    const wood = PALETTE.wood.deep;
    const moss = PALETTE.lawn.moss;
    const rust = PALETTE.metal.rust;
    b.add('box', wood, [x + 0.08, y + 0.02, z + 0.3], [0.6, 0.03, 0.07]); // the missing slat, on the ground
    b.add('box', rust, [x + 0.4, y + 0.025, z + 0.2], [0.05, 0.05, 0.14]); // a snapped foot
    b.add('box', moss, [x - 0.18, y + 0.19, z + 0.02], [0.26, 0.012, 0.18]); // moss on the seat
    b.add('box', moss, [x + 0.12, y + 0.42, z - 0.14], [0.2, 0.02, 0.05]); // and along the back rail
    b.add('box', rust, [x - 0.33, y + 0.1, z + 0.06], [0.055, 0.12, 0.12]); // rust on the iron ends
    b.add('box', rust, [x + 0.33, y + 0.07, z - 0.04], [0.055, 0.08, 0.1]);
  }

  private prop(b: Sink, prop: string, x: number, y: number, z: number, r: VRng) {
    if (this.propModel(prop, x, y, z)) {
      // the park bench keeps its little planter tree beside it
      // (beside the bench's right end, clear of the seat: it used to stand in the seat's front corner)
      if (prop === 'bench' && this.inPark) this.planterTree(b, x + ChunkRenderer.PLANTER_BESIDE, y, z - 0.04, this.level >= 3);
      if (prop === 'bench' && this.brokenBench(x, z)) this.benchDamage(b, x, y, z);
      return;
    }
    switch (prop) {
      case 'bench': {
        const L = this.level;
        if (L >= 2) {
          // Repaired: fresh slats, green iron legs, and a planter tree beside it that leafs out at 75%.
          b.add('box', PALETTE.wood.mid, [x, y + 0.18, z], [0.8, 0.05, 0.3]);
          b.add('box', PALETTE.wood.mid, [x, y + 0.32, z - 0.13], [0.8, 0.2, 0.04]);
          b.add('box', PALETTE.leaf.forest, [x - 0.32, y + 0.08, z], [0.05, 0.16, 0.28]);
          b.add('box', PALETTE.leaf.forest, [x + 0.32, y + 0.08, z], [0.05, 0.16, 0.28]);
        } else {
          // Broken: a weathered seat sagging onto one leg, the backrest fallen behind it.
          b.add('box', PALETTE.wood.dark, [x + 0.05, y + 0.14, z], [0.8, 0.05, 0.3]);
          b.add('box', PALETTE.wood.deep, [x - 0.05, y + 0.03, z - 0.3], [0.7, 0.04, 0.18]);
          b.add('box', PALETTE.metal.iron, [x + 0.32, y + 0.08, z], [0.05, 0.16, 0.28]);
        }
        if (this.inPark) this.planterTree(b, x + 0.38, y, z + 0.32, L >= 3);
        break;
      }
      case 'bandstand': {
        // One structure over its 2×2 footprint: drawn from its first (min x, min z) tile only.
        const first = PARK_LAYOUT.props.find((p) => p.prop === 'bandstand')!.at;
        if (Math.floor(x) !== first[0] || Math.floor(z) !== first[1]) break;
        const L = this.level;
        const cx = x + 0.5;
        const cz = z + 0.5;
        b.add('cylinder', PALETTE.props.gazeboBase[L >= 2 ? 1 : 0], [cx, y + 0.1, cz], [1.9, 0.2, 1.9]);
        for (let i = 0; i < 6; i++) {
          if (L < 2 && i === 4) continue; // a missing column until it's repaired
          const a = (i / 6) * Math.PI * 2;
          b.add('cylinder', PALETTE.props.gazeboPost[L >= 2 ? 1 : 0], [cx + Math.cos(a) * 0.78, y + 0.65, cz + Math.sin(a) * 0.78], [0.07, 0.9, 0.07]);
        }
        b.add('cone', PALETTE.props.gazeboRoof[L >= 4 ? 2 : L >= 2 ? 1 : 0], [cx, y + 1.3, cz], [2.1, 0.55, 2.1]);
        b.add('sphere', PALETTE.props.gazeboFinial[L >= 2 ? 1 : 0], [cx, y + 1.62, cz], 0.12);
        if (L >= 3) {
          // Bunting: little flags strung between the columns.
          const flags = PALETTE.props.bunting;
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            const sag = Math.abs(Math.sin((i / 3) * Math.PI)) * 0.08;
            b.add('box', flags[i % flags.length], [cx + Math.cos(a) * 0.95, y + 1.0 - sag, cz + Math.sin(a) * 0.95], [0.1, 0.12, 0.02]);
          }
        }
        break;
      }
      case 'lamp':
        if (this.level >= 3) {
          // Relit: standing again, with a warm glowing lantern.
          b.add('cylinder', PALETTE.metal.dark, [x, y + 0.04, z], [0.22, 0.08, 0.22]);
          b.add('cylinder', PALETTE.metal.mid, [x, y + 0.55, z], [0.06, 1.0, 0.06]);
          b.add('box', PALETTE.metal.mid, [x, y + 1.06, z], [0.22, 0.04, 0.22]);
          b.add('sphere', PALETTE.flowers.radiantDisc, [x, y + 0.96, z], 0.16, 1);
          b.add('cylinder', PALETTE.glow.lamp, [x, y + 0.002, z], [0.9, 0.004, 0.9], 0.12); // its pool of light
        } else {
          b.add('box', PALETTE.metal.mid, [x, y + 0.05, z], [0.9, 0.06, 0.08]); // toppled
          b.add('sphere', PALETTE.props.lampToppled, [x + 0.42, y + 0.07, z], 0.12);
        }
        break;
      case 'barrel':
        b.add('cylinder', this.level >= 2 ? PALETTE.props.binAlive : PALETTE.props.bin, [x, y + 0.25, z], [0.4, 0.5, 0.4]);
        if (this.level >= 2) b.add('cylinder', PALETTE.aqua.surface, [x, y + 0.505, z], [0.34, 0.01, 0.34]);
        break;
      case 'bollard':
        b.add('cylinder', this.level >= 4 ? PALETTE.building.parapetClean : PALETTE.metal.grey, [x, y + 0.2, z], [0.14, 0.4, 0.14]);
        if (this.level >= 4) b.add('sphere', PALETTE.flower[(((Math.floor(x) + Math.floor(z)) % PALETTE.flower.length) + PALETTE.flower.length) % PALETTE.flower.length], [x, y + 0.44, z], [0.2, 0.12, 0.2]); // a flower cap
        break;
      case 'pillar':
        b.add('box', this.level >= 4 ? PALETTE.stone.light : PALETTE.stone.mid, [x, y + 0.45, z], [0.32, 0.9, 0.32]);
        b.add('box', PALETTE.stone.dark, [x + 0.1, y + 0.95, z], [0.2, 0.12, 0.3]);
        if (this.level >= 4) b.add('sphere', PALETTE.leaf.ivy, [x + 0.12, y + 0.5, z + 0.12], [0.14, 0.6, 0.12]); // ivy up the sunny side
        break;
      case 'post':
        b.add('cylinder', PALETTE.wood.post, [x, y + 0.3, z], [0.12, 0.6, 0.12]);
        if (this.level >= 4) b.add('cylinder', PALETTE.trim.brass, [x, y + 0.5, z], [0.16, 0.05, 0.16]); // a brass band
        break;
      case 'stall':
        b.add('box', this.level >= 4 ? PALETTE.wood.light : PALETTE.wood.crate, [x, y + 0.25, z], [0.8, 0.5, 0.6]);
        b.add('box', PALETTE.props.awning[r.next() < 0.5 ? 0 : 1], [x, y + 0.62, z], [0.95, 0.06, 0.75]);
        if (this.level >= 4) for (let i = 0; i < 3; i++) b.add('sphere', PALETTE.props.produce[i], [x - 0.25 + i * 0.25, y + 0.54, z + 0.1], 0.12); // produce
        break;
      case 'drain':
        b.add('box', PALETTE.metal.drain, [x, y + 0.02, z], [0.6, 0.04, 0.6]);
        if (this.level >= 4) b.add('box', PALETTE.water, [x, y + 0.045, z], [0.5, 0.01, 0.5]);
        break;
      default:
        b.add('cylinder', PALETTE.wood.bark, [x, y + 0.12, z], [0.36, 0.24, 0.36]);
        b.add('cylinder', this.level >= 4 ? PALETTE.leaf.light : PALETTE.props.planterSoilDead, [x, y + 0.25, z], [0.3, 0.02, 0.3]);
        if (this.level >= 4) {
          // a mossy stump with mushrooms
          b.add('cylinder', PALETTE.props.mushroomStem, [x + 0.2, y + 0.05, z + 0.1], [0.04, 0.1, 0.04]);
          b.add('sphere', PALETTE.props.mushroom, [x + 0.2, y + 0.11, z + 0.1], [0.12, 0.06, 0.12]);
          b.add('sphere', PALETTE.flowers.radiantFar, [x - 0.18, y + 0.06, z + 0.16], [0.08, 0.05, 0.08]);
        }
    }
  }

  // ───────────── fog ─────────────

  /** Fog alpha of one tile cell (0 clear … 1 thick). Uses area state for chunks not generated yet. */
  private fogAt(x: number, z: number): number {
    const s = this.sim;
    const id = s.areas.map.areaOfCell(x, z);
    const fog = s.areas.fog(id);
    if (fog === 'cleared') return 0;
    if (fog === 'hidden') return 1; // hidden and sealed areas: a solid wall of fog (owner, 18 Nov 2026)
    // An open region has no fog left: it is restored anywhere (E21.5), so a sheet over every dead tile only washed
    // the whole region out to a white haze. Its dead ground reads by colour instead.
    return 0;
  }

  private buildFog(v: ChunkView) {
    v.fogDirty = false;
    const N = CHUNK;
    const x0 = v.cx * N;
    const z0 = v.cz * N;
    // Per-cell alpha with a one-cell border, then each grid vertex takes the average of its four cells,
    // which gives soft, rolling fog edges.
    const A: number[] = [];
    let any = false;
    for (let z = -1; z <= N; z++)
      for (let x = -1; x <= N; x++) {
        const a = this.fogAt(x0 + x, z0 + z);
        A.push(a);
        if (a > 0.01) any = true;
      }
    if (!any) {
      v.fog = this.setMesh(v.fog, 'fog', undefined, vertexColourMaterial(), false);
      return;
    }
    const W = N + 2;
    const cell = (x: number, z: number) => A[(z + 1) * W + (x + 1)];
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const h = this.sim.grid.layer(GROUND)!.height - (v.sunk ? SINK : 0);
    const terraced = this.sim.grid.terraced(GROUND);
    // Denser fog (owner, 18 Nov 2026): three thicker sheets (one on Simple fog), stacked higher.
    const sheets = this.lowFog
      ? [{ y: 0.5, alpha: 0.95, tint: [112, 121, 132] }]
      : [
          { y: 0.3, alpha: 0.85, tint: [104, 113, 124] },
          { y: 0.95, alpha: 0.72, tint: [124, 132, 142] },
          { y: 1.7, alpha: 0.5, tint: [138, 145, 154] },
        ];
    for (const sh of sheets) {
      const base = pos.length / 3;
      for (let z = 0; z <= N; z++)
        for (let x = 0; x <= N; x++) {
          const a = (cell(x - 1, z - 1) + cell(x, z - 1) + cell(x - 1, z) + cell(x, z)) / 4;
          const wob = 0.9 + 0.2 * Math.sin((x0 + x) * 0.9 + (z0 + z) * 1.3);
          // E21.24: on the terraces the fog follows the highest ground at each vertex
          const lift = terraced ? Math.max(levelY(levelAt(x0 + x - 1, z0 + z - 1)), levelY(levelAt(x0 + x, z0 + z - 1)), levelY(levelAt(x0 + x - 1, z0 + z)), levelY(levelAt(x0 + x, z0 + z))) : 0;
          pos.push(x0 + x, h + sh.y + a * 0.25 + lift, z0 + z);
          col.push(sh.tint[0], sh.tint[1], sh.tint[2], Math.round(Math.min(1, a * sh.alpha * wob) * 255));
        }
      for (let z = 0; z < N; z++)
        for (let x = 0; x < N; x++) {
          const i = base + z * (N + 1) + x;
          idx.push(i, i + N + 1, i + 1, i + 1, i + N + 1, i + N + 2);
        }
    }
    // Look 4.5: soft vertical curtains where the fog's thickness steps (its edge against cleared ground), fading
    // upward, so the fog-of-war has a side to it when seen from the low close-up camera instead of reading as a
    // flat card. Each cell owns its west and north edges (the border cells cover the chunk seams).
    const tint = this.lowFog ? [112, 121, 132] : [110, 119, 130];
    const curtainH = this.lowFog ? 1.4 : 2.2;
    const curtain = (ax: number, az: number, bx: number, bz: number, a: number, ox: number, oz: number) => {
      const base = pos.length / 3;
      const rows: [number, number][] = [[0.02, 0.85], [curtainH * 0.45, 0.62], [curtainH, 0]];
      for (const [y, k] of rows) {
        const al = Math.round(Math.min(1, a * k) * 255);
        pos.push(ax + ox, h + y, az + oz, bx + ox, h + y, bz + oz);
        col.push(tint[0], tint[1], tint[2], al, tint[0], tint[1], tint[2], al);
      }
      for (let r = 0; r < 2; r++) {
        const i = base + r * 2;
        idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
      }
    };
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const a = cell(x, z);
        const w = cell(x - 1, z);
        const n = cell(x, z - 1);
        // Inset a little into the foggy side, so the curtain stands at the fog's edge.
        if (Math.abs(a - w) > 0.15) curtain(x0 + x, z0 + z, x0 + x, z0 + z + 1, Math.max(a, w), a > w ? 0.15 : -0.15, 0);
        if (Math.abs(a - n) > 0.15) curtain(x0 + x, z0 + z, x0 + x + 1, z0 + z, Math.max(a, n), 0, a > n ? 0.15 : -0.15);
      }
    const m = new pc.Mesh(this.device);
    m.setPositions(pos);
    // the shader asks for normals even unlit (a console error every frame without them): straight up
    m.setNormals(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)));
    m.setColors32(col);
    m.setIndices(idx);
    m.update(pc.PRIMITIVE_TRIANGLES);
    if (!v.fogMat) {
      const mat = new pc.StandardMaterial();
      mat.useLighting = false;
      mat.diffuse = new pc.Color(0, 0, 0);
      mat.emissive = new pc.Color(this.fogTintBuilt.r, this.fogTintBuilt.g, this.fogTintBuilt.b);
      mat.emissiveVertexColor = true;
      mat.opacityVertexColor = true;
      mat.opacityVertexColorChannel = 'a';
      mat.blendType = pc.BLEND_NORMAL;
      mat.depthWrite = false;
      mat.cull = pc.CULLFACE_NONE;
      if (this.transitions) {
        try {
          mat.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('opacityPS', FOG_FRONT_PS);
        } catch {
          /* no per-material chunks: the fog fades as before */
        }
        mat.setParameter('uFogFront', [0, 0, 0, 0]);
      }
      v.fogMat = mat;
    }
    v.fogMat.opacity = 1;
    v.fogMat.update();
    v.fog = this.setMesh(v.fog, 'fog', m, v.fogMat, false);
  }
}

function dist(v: ChunkView, f: { x: number; z: number }) {
  return Math.hypot(v.cx * CHUNK + 8 - f.x, v.cz * CHUNK + 8 - f.z);
}

/** E21.22: does the sight line from the eye to a point pass through a building's box (its footprint, base to top)? */
export function blocksSight(eye: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, t: { x: number; z: number; r: number; base: number; top: number }): boolean {
  for (let i = 1; i < 40; i++) {
    const k = i / 40;
    const x = eye.x + (to.x - eye.x) * k;
    const y = eye.y + (to.y - eye.y) * k;
    const z = eye.z + (to.z - eye.z) * k;
    if (Math.abs(x - t.x) <= t.r && Math.abs(z - t.z) <= t.r && y >= t.base && y <= t.top) return true;
  }
  return false;
}

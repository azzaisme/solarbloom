import * as pc from 'playcanvas';
import { CHUNK } from '../core/Hash';
import { GROUND } from '../core/GameState';
import { chunkKey } from '../core/Grid';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { CITY_GEN, PARK_LAYOUT } from '../data/city';
import { buildingPlots, type BuildingPlot } from '../core/Generation';
import { PALETTE } from './Materials';
import { grassTone } from './Palette';
import { lowGeometry, vertexColourMaterial, type VPrim } from './Shapes';
import { FoliageBuilder, foliageMaterial, treeMesh, updateWind } from './Foliage';
import { shrubGeo, treeGeo, warmTemplates } from './TreeGen';
import { treeSpot, treeStage } from './TreePlacement';

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
function lin(hex: string): [number, number, number] {
  let c = linCache.get(hex);
  if (!c) {
    const col = new pc.Color();
    col.fromString(hex);
    c = [Math.pow(col.r, 2.2), Math.pow(col.g, 2.2), Math.pow(col.b, 2.2)];
    linCache.set(hex, c);
  }
  return c;
}

/** Accumulates transformed primitives into one vertex-coloured mesh. */
class MeshBuilder {
  private pos = new Grow(new Float32Array(1 << 15));
  private nrm = new Grow(new Float32Array(1 << 15));
  private col = new Grow(new Uint8Array(1 << 15));
  private idx = new Grow(new Uint32Array(1 << 14));
  /** 0 = full colour … 1 = fully grey (fog / desaturation) */
  grey = 0;
  /** Look 2.2: when set, colours fade from the given colour at the bottom of a primitive to this one at its top. */
  tip = '';

  add(type: VPrim, hex: string, p: [number, number, number], s: [number, number, number] | number) {
    const t = template(type);
    let sx: number, sy: number, sz: number;
    if (typeof s === 'number') sx = sy = sz = s;
    else [sx, sy, sz] = s;
    const [R, G, B] = this.rgb(hex);
    const [R2, G2, B2] = this.tip ? this.rgb(this.tip) : [R, G, B];
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
      C[c + 3] = 255;
    }
    this.pos.n = this.nrm.n = o;
    this.col.n = c;
    let k = this.idx.n;
    for (let i = 0; i < t.idx.length; i++) I[k++] = base + t.idx[i];
    this.idx.n = k;
  }

  /** A colour as 0–255 linear vertex channels, greyed for fog. */
  private rgb(hex: string): [number, number, number] {
    let [r, g, b] = lin(hex);
    if (this.grey > 0) {
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      const k = this.grey;
      r = r + (l * 0.85 - r) * k;
      g = g + (l * 0.88 - g) * k;
      b = b + (l * 0.95 - b) * k;
    }
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
const EDGE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const hash01 = (x: number, z: number, salt: number) => {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
const ALIVE = PALETTE.ground.alive;

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
}

/**
 * Renders the endless city ground: one merged, vertex-coloured mesh per 16×16 chunk (slabs + decoration),
 * streamed in around the camera and rebuilt within a per-frame budget when its tiles change, plus a per-tile
 * fog mesh that hangs over fogged areas and recedes tile by tile as the player restores.
 */
export class ChunkRenderer {
  private views = new Map<string, ChunkView>();
  private root: pc.Entity;
  reducedMotion = false;
  /** Max chunk meshes rebuilt per frame (keeps frames smooth while panning or during big chains). */
  /** most chunk rebuilds per frame, and the time they may take (ms) */
  budget = 4;
  budgetMs = 6;
  private time = 0;
  private lastFocus = { x: 8, z: 8 };

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

  /** An area's fog state changed: refresh its chunks (and their neighbours, for soft edges). */
  markArea(id: string, fade = false) {
    for (const [cx, cz] of this.sim.areas.info(id).chunks)
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const v = this.views.get(chunkKey(GROUND, cx + dx, cz + dz));
          if (!v) continue;
          v.dirty = true;
          if (fade && dx === 0 && dz === 0 && v.fogMat && !this.reducedMotion) v.fading = true;
          else v.fogDirty = true;
        }
  }

  /** Settings → Simple fog: one fog layer instead of two. */
  lowFog = false;

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

  update(dt: number, rect: { x0: number; x1: number; z0: number; z1: number }, focus: { x: number; z: number }, zoom = 1) {
    this.time += dt;
    this.warmTrees();
    this.tickGrowing(dt);
    updateWind(this.time, this.reducedMotion ? 0 : 1); // Phase 5: trees sway (still with reduced motion)
    const ps = this.sim.grid.isPlayable(GROUND) ? this.sim.progression.parkStage() : 0;
    if (ps !== this.parkStage) {
      const prev = this.parkStage;
      this.parkStage = ps;
      const v = this.views.get(chunkKey(GROUND, 0, 0));
      if (v) v.dirty = true;
      if (prev >= 0 && ps > prev) this.onParkStage?.(ps, prev);
    }
    this.farFrom = zoom < 0.55 ? 2 : Infinity;
    for (const v of this.views.values()) {
      const far = dist(v, focus) / CHUNK > this.farFrom;
      if (v.ground && !!v.far !== far) v.dirty = true;
    }
    const cx0 = Math.floor(rect.x0 / CHUNK) - 1;
    const cx1 = Math.floor(rect.x1 / CHUNK) + 1;
    const cz0 = Math.floor(rect.z0 / CHUNK) - 1;
    const cz1 = Math.floor(rect.z1 / CHUNK) + 1;
    const want = new Set<string>();
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = chunkKey(GROUND, cx, cz);
        want.add(key);
        if (!this.views.has(key)) this.views.set(key, { key, cx, cz, dirty: true, fogDirty: true });
      }
    // Drop chunks well outside the view (one extra ring of hysteresis).
    for (const [key, v] of this.views) {
      if (want.has(key)) continue;
      if (v.cx < cx0 - 1 || v.cx > cx1 + 1 || v.cz < cz0 - 1 || v.cz > cz1 + 1) this.drop(v);
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
    const dirty = [...this.views.values()].filter((v) => v.dirty || (v.fogDirty && !v.fading));
    dirty.sort((a, b) => dist(a, focus) - dist(b, focus));
    // Rebuild nearest first, within a time budget (at least one per frame so streaming always progresses).
    const t0 = performance.now();
    let n = 0;
    for (const v of dirty) {
      if (n >= this.budget || (n > 0 && performance.now() - t0 > this.budgetMs)) break;
      if (v.dirty) this.buildGround(v);
      if (v.fogDirty && !v.fading) this.buildFog(v);
      n++;
    }
    // Gentle drift of the fog sheets.
    if (!this.reducedMotion)
      for (const v of this.views.values()) if (v.fog) v.fog.setLocalPosition(0, Math.sin(this.time * 0.4 + v.cx * 0.7 + v.cz) * 0.04, 0);
  }

  private drop(v: ChunkView) {
    v.ground?.destroy();
    v.trees?.destroy();
    v.fog?.destroy();
    this.views.delete(v.key);
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

  private buildGround(v: ChunkView) {
    v.dirty = false;
    const s = this.sim;
    const c = s.grid.chunkAt(GROUND, v.cx, v.cz);
    if (!c) return;
    const b = new MeshBuilder();
    const fb = new FoliageBuilder();
    this.fb = fb;
    const area = s.areas.map.areaOfChunk(v.cx, v.cz);
    this.areaType = s.areas.info(area).type;
    const fog = s.areas.fog(area);
    const h = s.grid.layer(GROUND)!.height;
    v.far = dist(v, this.lastFocus) / CHUNK > this.farFrom;
    // Props in the park follow its stage; elsewhere they're broken until their area clears.
    this.level = area === 'park' ? Math.max(0, this.parkStage) : fog === 'cleared' ? 4 : 0;
    this.inPark = area === 'park';
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
    for (const t of c.tiles) {
      if (!t) continue;
      // Hidden ground is grey; fogged ground is greyed unless restored.
      b.grey = fog === 'hidden' ? 0.75 : fog === 'cleared' || t.ground === 'restored' ? 0 : 0.35;
      fb.grey = b.grey;
      if (v.far) this.farTile(b, t, h);
      else this.tile(b, t, h);
    }
    // Buildings (generation 2): grey and shuttered in the fog, white with roof gardens once the area is clear.
    if ((s.grid.layer(GROUND)!.gen ?? 1) >= 2) {
      b.grey = fog === 'hidden' ? 0.75 : fog === 'cleared' ? 0 : 0.45;
      for (const p of buildingPlots(s.grid.seed, v.cx, v.cz, s.grid.layer(GROUND)!.gen ?? 1)) {
        // An entry fix may have opened one of its tiles: then it's rubble, not a building.
        const whole = s.grid.peek(GROUND, p.x, p.z)?.feature === 'building' && s.grid.peek(GROUND, p.x + p.w - 1, p.z + p.d - 1)?.feature === 'building';
        if (whole) this.building(b, p, h, fog === 'cleared', v.far);
      }
    }
    v.ground = this.setMesh(v.ground, `chunk-${v.key}`, b.build(this.device), vertexColourMaterial(), !v.far); // far chunks: no shadow pass (invisible at that distance, halves their draw calls)
    v.trees = this.setMesh(v.trees, `trees-${v.key}`, fb.build(this.device), foliageMaterial(), !v.far);
    this.treeTris.set(v.key, fb.tris);
  }

  /** Look 2.3: the warm stone tone of one restored paving slab (stable per tile). */
  private slabTone(t: TileData): string {
    const s = PALETTE.paving.slabs;
    return s[Math.floor(hash01(t.x, t.z, 41) * s.length) % s.length];
  }

  /** Far level of detail: one coloured slab per tile, with a bump for full bloom. */
  private farTile(b: MeshBuilder, t: TileData, h: number) {
    const f = t.feature ?? 'lawn';
    const dead = DEAD[f] ?? DEAD.lawn;
    const stage = Math.max(1, Math.min(4, t.bloom || 1));
    const col = t.blocked ? dead[0] : t.ground === 'restored' ? (f === 'water' ? ALIVE.water : f === 'paving' ? this.slabTone(t) : grassTone(stage, t.x, t.z)) : t.ground === 'polluted' ? dead[t.variant % dead.length] : PALETTE.soil;
    b.add('box', col, [t.x + 0.5, h, t.z + 0.5], [1, 0.16, 1]);
    // Phase 5 E16: stages stay apart zoomed out too: a colour patch for Blooming, a gold disc for Radiant.
    if (t.ground === 'restored' && f !== 'water' && f !== 'paving') {
      if (stage === 2) b.add('box', PALETTE.flower[t.variant % PALETTE.flower.length], [t.x + 0.4, h + 0.085, t.z + 0.55], [0.34, 0.02, 0.3]);
      if (stage === 4) b.add('cylinder', PALETTE.flowers.radiantFar, [t.x + 0.5, h + 0.085, t.z + 0.5], [0.8, 0.02, 0.8]);
    }
    if (this.addTree(t, h, 0)) return;
    if (t.ground === 'restored' && t.bloom >= 3 && f !== 'water') this.fb.add(shrubGeo(t.variant, 0), t.x + 0.5, h + 0.08, t.z + 0.5, t.variant, 1);
  }

  // ───────────── trees (Phase 5) ─────────────

  /** The foliage builder of the chunk being built, and its area type (tree species follow it). */
  private fb = new FoliageBuilder();
  private areaType = 'park';
  /** Foliage triangles per loaded chunk (perf readout). */
  readonly treeTris = new Map<string, number>();

  /** Adds the tile's tree at its stage, unless it's growing on its own right now. True if the tile has one. */
  private addTree(t: TileData, h: number, lod: 0 | 1): boolean {
    if ((t.feature ?? 'lawn') === 'water') return false;
    const spot = treeSpot(t, this.areaType);
    if (!spot) return false;
    const stage = treeStage(t);
    if (!stage) return false;
    if (this.growing.has(t.id)) return true;
    this.fb.add(treeGeo(spot.species, stage, spot.variant, lod), t.x + 0.5, h + 0.08 + (spot.planter ? 0.16 : 0), t.z + 0.5, spot.rot, spot.scale);
    return true;
  }

  /** Fills the tree template cache a few milliseconds per frame after load (no first-pan generation spike). */
  private warm: Generator<void> | undefined = warmTemplates();
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
    if (t.roofId !== GROUND || this.reducedMotion || this.growing.size >= ChunkRenderer.MAX_GROWING) return;
    const view = this.views.get(chunkKey(GROUND, Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK)));
    if (!view || view.far) return;
    const spot = treeSpot(t, this.sim.areas.info(this.sim.areas.areaOf(t)!).type);
    const stage = treeStage(t);
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

  /** Look of the chunk being built: prop level 0–4, and whether it's the park. */
  private level = 0;
  private inPark = false;
  /** Phase 5 E16: the obstacle tile shown as this chunk's local landmark (cleared areas only). */
  private localMark?: string;

  /**
   * Phase 5 E16: a small local landmark on an obstacle cell (never a build cell), by area type: a flower arch on
   * streets and rooftops, an ivy statue in plazas, a topiary in markets, a lantern post with a hanging basket by
   * canals, a spouting basin at reservoirs, a mushroom ring in groves. Meshy hook: these are candidates for the
   * "edge clutter" / obstacle set in docs/art/meshy-assets.md.
   */
  private landmark(b: MeshBuilder, x: number, y: number, z: number, variant: number) {
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

  private tile(b: MeshBuilder, t: TileData, h: number) {
    const x = t.x + 0.5;
    const z = t.z + 0.5;
    const f = t.feature ?? 'lawn';
    const r = new VRng(t.variant * 7919 + 13);
    const dead = DEAD[f] ?? DEAD.lawn;
    if (t.blocked) {
      b.add('box', dead[t.variant % dead.length], [x, h, z], [0.96, 0.16, 0.96]);
      if (t.feature === 'building') return;
      if (t.id === this.localMark) this.landmark(b, x, h + 0.08, z, t.variant);
      else this.prop(b, t.prop ?? 'stump', x, h + 0.08, z, r);
      return;
    }
    if (t.occupantId) {
      b.add('box', t.ground === 'restored' ? grassTone(Math.max(1, t.bloom || 1), t.x, t.z) : PALETTE.soil, [x, h, z], [1, 0.16, 1]);
      return;
    }
    const top = h + 0.08;
    switch (t.ground) {
      case 'polluted': {
        const shade = t.pollution > 80 ? dead[(t.variant + 1) % dead.length] : dead[t.variant % dead.length];
        b.add('box', shade, [x, h, z], [0.96, 0.16, 0.96]);
        if (f === 'road') {
          if (t.variant % 3 === 0) b.add('box', PALETTE.paving.roadLine, [x, top + 0.004, z], [0.12, 0.01, 0.4]);
        } else if (f === 'water') {
          b.add('box', PALETTE.ground.scum, [x, top + 0.005, z], [0.8, 0.01, 0.8]);
        } else if (this.inPark && this.level >= 1) {
          // Swept: the litter is gone, a few weeds remain; paving is scrubbed lighter.
          if (f === 'paving') b.add('box', PALETTE.paving.swept, [x, h + 0.001, z], [0.9, 0.161, 0.9]);
          if (t.variant % 3 === 0) b.add('box', PALETTE.paving.grout, [x + r.range(-0.2, 0.2), top + 0.004, z + r.range(-0.2, 0.2)], [r.range(0.2, 0.4), 0.01, 0.03]);
          if (r.next() < 0.3) b.add('cone', PALETTE.lawn.weedDry, [x + r.range(-0.3, 0.3), top + 0.05, z + r.range(-0.3, 0.3)], [0.06, 0.1, 0.06]);
        } else {
          for (let i = 0; i < 1 + (t.variant % 2); i++) b.add('box', PALETTE.paving.crack, [x + r.range(-0.25, 0.25), top + 0.004, z + r.range(-0.25, 0.25)], [r.range(0.3, 0.6), 0.01, 0.035]);
          if (r.next() < 0.4) b.add('cone', PALETTE.lawn.weedDark, [x + r.range(-0.3, 0.3), top + 0.05, z + r.range(-0.3, 0.3)], [0.06, 0.1, 0.06]);
          // Leaf litter: groves always, the dilapidated park until its paths are swept.
          if (f === 'litter' || this.inPark) for (let i = 0; i < (this.inPark ? 2 + (t.variant % 3) : 3); i++) b.add('sphere', PALETTE.ground.leafLitter[i % 3], [x + r.range(-0.35, 0.35), top + 0.01, z + r.range(-0.35, 0.35)], [0.16, 0.03, 0.1]);
        }
        break;
      }
      case 'prepared':
      case 'growing': {
        b.add('box', f === 'water' ? PALETTE.ground.wetSoil : PALETTE.soil, [x, h, z], [0.96, 0.16, 0.96]);
        const n = t.ground === 'growing' ? 5 : 3 + (t.variant % 3);
        for (let i = 0; i < n; i++) {
          const sx = x + r.range(-0.3, 0.3);
          const sz = z + r.range(-0.3, 0.3);
          if (t.ground === 'growing') {
            b.tip = PALETTE.lawn.youngTuftTip[i % 3];
            b.add('cone', PALETTE.lawn.youngTuft[i % 3], [sx, top + 0.06, sz], [0.05, 0.12, 0.05]);
            b.tip = '';
          }
          else b.add('sphere', PALETTE.moss, [sx, top + 0.005, sz], [r.range(0.14, 0.26), 0.05, r.range(0.12, 0.24)]);
        }
        break;
      }
      case 'restored': {
        if (f === 'water') {
          b.add('box', ALIVE.water, [x, h - 0.02, z], [1, 0.12, 1]);
          if (t.variant % 2) b.add('cylinder', PALETTE.leaf.mid, [x + r.range(-0.25, 0.25), top - 0.035, z + r.range(-0.25, 0.25)], [0.22, 0.01, 0.22]);
          if (t.bloom >= 2 && t.variant % 3 === 0) b.add('sphere', PALETTE.flowers.blush, [x + r.range(-0.2, 0.2), top - 0.02, z + r.range(-0.2, 0.2)], 0.07);
          break;
        }
        this.restoredTile(b, t, h, x, z, top, f, r);
        break;
      }
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
  private restoredTile(b: MeshBuilder, t: TileData, h: number, x: number, z: number, top: number, f: string, r: VRng) {
    const stage = Math.max(1, Math.min(4, t.bloom || 1));
    const grass = grassTone(stage, t.x, t.z);
    if (f === 'paving') {
      // Clean stone with a planted bed. Look 2.3: each slab its own warm tone, set in darker grout, the odd hairline crack.
      b.add('box', PALETTE.paving.grout, [x, h - 0.004, z], [1, 0.152, 1]);
      b.add('box', this.slabTone(t), [x, h, z], [0.92, 0.16, 0.92]);
      if (hash01(t.x, t.z, 43) < 0.3) b.add('box', PALETTE.paving.crack, [x + (hash01(t.x, t.z, 44) - 0.5) * 0.4, top + 0.002, z + (hash01(t.x, t.z, 45) - 0.5) * 0.4], [0.18 + hash01(t.x, t.z, 46) * 0.2, 0.006, 0.02]);
      if (treeSpot(t, this.areaType)?.planter) {
        // a cream planter with a brass rim for the street tree
        b.add('box', PALETTE.stone.cream, [x, top + 0.08, z], [0.62, 0.16, 0.62]);
        b.add('box', PALETTE.trim.brass, [x, top + 0.162, z], [0.66, 0.02, 0.66]);
        b.add('box', PALETTE.soil, [x, top + 0.165, z], [0.54, 0.01, 0.54]);
      } else b.add('box', grass, [x, top + 0.01, z], [0.6, 0.02, 0.6]);
      this.edges(b, t, x, z, top, true);
    } else {
      b.add('box', grass, [x, h, z], [1, 0.16, 1]);
      this.edges(b, t, x, z, top, false);
    }
    const tufts = f === 'paving' ? 3 : stage === 1 ? 4 : 5;
    const tuftH = stage === 1 ? [0.06, 0.12] : [0.09, 0.2];
    for (let i = 0; i < tufts; i++) {
      const ht = r.range(tuftH[0], tuftH[1]);
      const span = f === 'paving' ? 0.25 : 0.42;
      b.tip = (stage === 1 ? PALETTE.lawn.youngTuftTip : PALETTE.lawn.tuftTip)[i % 3];
      b.add('cone', (stage === 1 ? PALETTE.lawn.youngTuft : PALETTE.lawn.tuft)[i % 3], [x + r.range(-span, span), top + ht / 2, z + r.range(-span, span)], [0.055, ht, 0.055]);
      b.tip = '';
    }
    const span = f === 'paving' ? 0.2 : 0.3;
    if (stage >= 2) {
      // Flower clusters: tight groups of one colour (seeded), so blooming ground shows patches, not confetti.
      const clusters = stage === 2 ? 2 : 1;
      for (let c = 0; c < clusters; c++) {
        const cx = x + r.range(-span, span);
        const cz = z + r.range(-span, span);
        const col = PALETTE.flower[(t.variant + c * 2) % PALETTE.flower.length];
        const n = 3 + ((t.variant + c) % 2);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + r.next();
          const fx = cx + Math.cos(a) * 0.09;
          const fz = cz + Math.sin(a) * 0.09;
          const ht = r.range(0.12, 0.22);
          b.add('cylinder', PALETTE.stem, [fx, top + ht / 2, fz], [0.02, ht, 0.02]);
          b.add('sphere', col, [fx, top + ht, fz], [0.13, 0.08, 0.13]);
        }
        b.add('sphere', PALETTE.flowerCore, [cx, top + 0.2, cz], 0.06);
      }
    }
    // Phase 5: a tree tile grows its tree from a sapling (Restored) to Radiant; other Thriving tiles get a seeded mix.
    if (!this.addTree(t, h, 1) && stage >= 3 && f !== 'paving') {
      const pick = hash01(t.x, t.z, 61);
      if (pick < 0.62) this.fb.add(shrubGeo(t.variant, 1), x + (t.variant % 3) * 0.06 - 0.06, top, z, t.variant * 1.7, 1);
      else if (pick < 0.82) {
        // tall flower spikes (lupins, foxgloves)
        const col = PALETTE.flowers.spikes[t.variant % 4];
        for (let i = 0; i < 3; i++) {
          const fx = x + r.range(-0.25, 0.25);
          const fz = z + r.range(-0.25, 0.25);
          const ht = r.range(0.36, 0.52);
          b.add('cylinder', PALETTE.stem, [fx, top + ht / 2, fz], [0.025, ht, 0.025]);
          b.add('cone', col, [fx, top + ht + 0.06, fz], [0.09, 0.22, 0.09]);
        }
      } else {
        // a mossy rock with a fern
        const rx = x + r.range(-0.2, 0.2);
        const rz = z + r.range(-0.2, 0.2);
        b.add('sphere', PALETTE.stone.grey, [rx, top + 0.06, rz], [0.34, 0.2, 0.28]);
        b.add('sphere', PALETTE.leaf.light, [rx, top + 0.13, rz], [0.24, 0.07, 0.2]);
        b.add('cone', PALETTE.flowers.stem, [rx + 0.18, top + 0.1, rz - 0.1], [0.12, 0.2, 0.12]);
      }
    } else if (stage <= 2 && f !== 'paving' && !treeSpot(t, this.areaType) && hash01(t.x, t.z, 67) < 0.07) {
      // the odd pebble in young lawns (seeded), so open lawn doesn't repeat exactly
      b.add('sphere', PALETTE.stone.pebble, [x + r.range(-0.3, 0.3), top + 0.03, z + r.range(-0.3, 0.3)], [0.16, 0.08, 0.13]);
    }
    if (stage >= 4) {
      // Phase 4 E05: Radiant: a pale golden glow on the ground and luminous gold flowers above the shrubs.
      b.add('cylinder', PALETTE.flowers.radiantDisc, [x, top + 0.005, z], [0.86, 0.01, 0.86]);
      for (let i = 0; i < 4; i++) {
        const fx = x + r.range(-0.34, 0.34);
        const fz = z + r.range(-0.34, 0.34);
        const ht = r.range(0.3, 0.46);
        b.add('cylinder', PALETTE.stem, [fx, top + ht / 2, fz], [0.02, ht, 0.02]);
        b.add('sphere', PALETTE.flowers.radiant[i % 2 ? 0 : 1], [fx, top + ht, fz], [0.13, 0.1, 0.13]);
      }
    }
  }

  /**
   * Phase 5 E16: where restored lawn meets restored paving, the lawn gets a trimmed darker edge and the paving a
   * raised white border (only on that side; neighbours in chunks not generated yet are skipped).
   */
  private edges(b: MeshBuilder, t: TileData, x: number, z: number, top: number, paving: boolean) {
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
  /** A procedural building from a small kit: body, window bands, parapet, and a roof that blooms when clear. */
  private building(b: MeshBuilder, p: BuildingPlot, h: number, alive: boolean, far = false) {
    const H = p.storeys * CITY_GEN.buildings.storey;
    const cx = p.x + p.w / 2;
    const cz = p.z + p.d / 2;
    const bw = p.w - 0.25;
    const bd = p.d - 0.25;
    const top = h + 0.08 + H;
    const wallsDead = PALETTE.building.wallsDead;
    const wallsAlive = PALETTE.building.wallsAlive;
    const wall = (alive ? wallsAlive : wallsDead)[p.style % 5];
    b.add('box', wall, [cx, h + 0.08 + H / 2, cz], [bw, H, bd]);
    if (far) {
      b.add('box', alive ? PALETTE.building.roofGarden : PALETTE.building.roofDead, [cx, top + 0.03, cz], [bw * 0.9, 0.06, bd * 0.9]);
      return;
    }
    // Window bands on the two faces the camera sees (south and east), one per storey.
    const glass = alive ? PALETTE.building.glassAlive : PALETTE.building.glassDead;
    for (let i = 0; i < p.storeys; i++) {
      const y = h + 0.08 + CITY_GEN.buildings.storey * (i + 0.55);
      b.add('box', glass, [cx, y, p.z + p.d - 0.12 + 0.005], [bw * 0.82, CITY_GEN.buildings.storey * 0.38, 0.02]);
      b.add('box', glass, [p.x + p.w - 0.12 + 0.005, y, cz], [0.02, CITY_GEN.buildings.storey * 0.38, bd * 0.82]);
    }
    // Parapet and roof.
    b.add('box', alive ? PALETTE.building.parapetAlive : PALETTE.stone.shadow, [cx, top + 0.04, cz], [bw + 0.06, 0.08, bd + 0.06]);
    if (alive) {
      // A roof garden, a solar panel or two, and vines down the sunny face.
      b.add('box', PALETTE.building.gardenBed, [cx, top + 0.09, cz], [bw * 0.86, 0.05, bd * 0.86]);
      const r = new VRng(p.style * 131 + p.x * 7 + p.z * 13);
      for (let i = 0; i < 1 + (p.style % 2); i++) b.add('box', PALETTE.panel, [p.x + 0.6 + i * 0.7, top + 0.2, p.z + 0.6], [0.5, 0.04, 0.4]);
      for (let i = 0; i < 3; i++) b.add('sphere', PALETTE.shrub[i % 3], [p.x + r.range(0.5, p.w - 0.5), top + 0.18, p.z + r.range(0.9, p.d - 0.4)], [0.32, 0.22, 0.32]);
      for (let i = 0; i < 2; i++) b.add('box', PALETTE.leaf.ivy, [p.x + 0.4 + i * (p.w - 0.8), h + 0.08 + H * 0.5, p.z + p.d - 0.1], [0.12, H * 0.9, 0.03]);
    } else {
      // A rusty water tank or a dead antenna on the roof.
      if (p.style % 3 === 0) b.add('cylinder', PALETTE.building.tank, [p.x + 0.6, top + 0.3, p.z + 0.6], [0.4, 0.45, 0.4]);
      else b.add('box', PALETTE.paving.crack, [p.x + p.w - 0.5, top + 0.4, p.z + 0.5], [0.04, 0.7, 0.04]);
    }
  }

  /** A tree in a stone planter: bare twigs until it leafs out. */
  private planterTree(b: MeshBuilder, x: number, y: number, z: number, leafy: boolean) {
    b.add('box', leafy ? PALETTE.stone.warm : PALETTE.props.planterDead, [x, y + 0.09, z], [0.26, 0.18, 0.26]);
    if (leafy) this.fb.add(treeGeo('cherry', 2, 1, 1), x, y + 0.18, z, 0.7, 0.55); // Phase 5: a real little tree
    else {
      b.add('cylinder', PALETTE.trunk, [x, y + 0.36, z], [0.04, 0.4, 0.04]);
      b.add('box', PALETTE.wood.bark, [x + 0.05, y + 0.58, z], [0.14, 0.02, 0.02]);
      b.add('box', PALETTE.wood.bark, [x - 0.04, y + 0.52, z + 0.03], [0.02, 0.02, 0.12]);
    }
  }

  private prop(b: MeshBuilder, prop: string, x: number, y: number, z: number, r: VRng) {
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
          b.add('sphere', PALETTE.flowers.radiantDisc, [x, y + 0.96, z], 0.16);
          b.add('cylinder', PALETTE.glow.lamp, [x, y + 0.002, z], [0.9, 0.004, 0.9]); // its pool of light
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
    if (fog === 'hidden') return 0.95;
    const t = s.grid.peek(GROUND, x, z);
    if (!t) return s.areas.density(id);
    if (t.ground === 'restored' || t.ground === 'growing') return 0;
    if (id === 'park') return 0;
    if (s.areas.canTouch(t)) return 0.3;
    return 0.35 + 0.6 * s.areas.density(id);
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
    const h = this.sim.grid.layer(GROUND)!.height;
    const sheets = this.lowFog
      ? [{ y: 0.5, alpha: 0.82, tint: [112, 121, 132] }]
      : [
          { y: 0.32, alpha: 0.62, tint: [104, 113, 124] },
          { y: 0.85, alpha: 0.5, tint: [128, 136, 146] },
        ];
    for (const sh of sheets) {
      const base = pos.length / 3;
      for (let z = 0; z <= N; z++)
        for (let x = 0; x <= N; x++) {
          const a = (cell(x - 1, z - 1) + cell(x, z - 1) + cell(x - 1, z) + cell(x, z)) / 4;
          const wob = 0.9 + 0.2 * Math.sin((x0 + x) * 0.9 + (z0 + z) * 1.3);
          pos.push(x0 + x, h + sh.y + a * 0.25, z0 + z);
          col.push(sh.tint[0], sh.tint[1], sh.tint[2], Math.round(Math.min(1, a * sh.alpha * wob) * 255));
        }
      for (let z = 0; z < N; z++)
        for (let x = 0; x < N; x++) {
          const i = base + z * (N + 1) + x;
          idx.push(i, i + N + 1, i + 1, i + 1, i + N + 1, i + N + 2);
        }
    }
    const m = new pc.Mesh(this.device);
    m.setPositions(pos);
    m.setColors32(col);
    m.setIndices(idx);
    m.update(pc.PRIMITIVE_TRIANGLES);
    if (!v.fogMat) {
      const mat = new pc.StandardMaterial();
      mat.useLighting = false;
      mat.diffuse = new pc.Color(0, 0, 0);
      mat.emissive = new pc.Color(1, 1, 1);
      mat.emissiveVertexColor = true;
      mat.opacityVertexColor = true;
      mat.opacityVertexColorChannel = 'a';
      mat.blendType = pc.BLEND_NORMAL;
      mat.depthWrite = false;
      mat.cull = pc.CULLFACE_NONE;
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

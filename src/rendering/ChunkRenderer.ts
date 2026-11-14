import * as pc from 'playcanvas';
import { CHUNK } from '../core/Hash';
import { GROUND } from '../core/GameState';
import { chunkKey } from '../core/Grid';
import type { TileData } from '../core/types';
import type { Sim } from '../gameplay/Sim';
import { CITY_GEN, PARK_LAYOUT } from '../data/city';
import { buildingPlots, type BuildingPlot } from '../core/Generation';
import { PALETTE } from './Materials';
import { lowGeometry, vertexColourMaterial, type VPrim } from './Shapes';

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

  add(type: VPrim, hex: string, p: [number, number, number], s: [number, number, number] | number) {
    const t = template(type);
    let sx: number, sy: number, sz: number;
    if (typeof s === 'number') sx = sy = sz = s;
    else [sx, sy, sz] = s;
    let [r, g, b] = lin(hex);
    if (this.grey > 0) {
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      const k = this.grey;
      r = r + (l * 0.85 - r) * k;
      g = g + (l * 0.88 - g) * k;
      b = b + (l * 0.95 - b) * k;
    }
    const R = Math.round(r * 255);
    const G = Math.round(g * 255);
    const B = Math.round(b * 255);
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
      C[c] = R;
      C[c + 1] = G;
      C[c + 2] = B;
      C[c + 3] = 255;
    }
    this.pos.n = this.nrm.n = o;
    this.col.n = c;
    let k = this.idx.n;
    for (let i = 0; i < t.idx.length; i++) I[k++] = base + t.idx[i];
    this.idx.n = k;
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

/** Ground colours per material, dead → alive. */
const DEAD: Record<string, string[]> = {
  lawn: ['#8a7b5f', '#837357', '#91825f'],
  paving: ['#9a9890', '#8f8d86', '#a3a097'],
  road: ['#55585c', '#4e5155', '#5b5e62'],
  water: ['#4e5a52', '#475249', '#56625a'],
  clay: ['#bda78a', '#b29c7f', '#c6b195'],
  litter: ['#867c6a', '#7c7261', '#908571'],
  obstacle: ['#7d7b74', '#76746d', '#85837b'],
  building: ['#8d8a82', '#86837b', '#94918a'],
};
const ALIVE: Record<string, string> = { lawn: '', paving: '#e9e4d8', road: '', water: '#5cc6e6', clay: '', litter: '', obstacle: '#d9d4c8' };

interface ChunkView {
  key: string;
  cx: number;
  cz: number;
  ground?: pc.Entity;
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
    const area = s.areas.map.areaOfChunk(v.cx, v.cz);
    const fog = s.areas.fog(area);
    const h = s.grid.layer(GROUND)!.height;
    v.far = dist(v, this.lastFocus) / CHUNK > this.farFrom;
    // Props in the park follow its stage; elsewhere they're broken until their area clears.
    this.level = area === 'park' ? Math.max(0, this.parkStage) : fog === 'cleared' ? 4 : 0;
    this.inPark = area === 'park';
    for (const t of c.tiles) {
      if (!t) continue;
      // Hidden ground is grey; fogged ground is greyed unless restored.
      b.grey = fog === 'hidden' ? 0.75 : fog === 'cleared' || t.ground === 'restored' ? 0 : 0.35;
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
  }

  /** Far level of detail: one coloured slab per tile, with a bump for full bloom. */
  private farTile(b: MeshBuilder, t: TileData, h: number) {
    const f = t.feature ?? 'lawn';
    const dead = DEAD[f] ?? DEAD.lawn;
    const col = t.blocked ? dead[0] : t.ground === 'restored' ? (f === 'water' ? ALIVE.water : f === 'paving' ? ALIVE.paving : PALETTE.grass[t.variant % PALETTE.grass.length]) : t.ground === 'polluted' ? dead[t.variant % dead.length] : PALETTE.soil;
    b.add('box', col, [t.x + 0.5, h, t.z + 0.5], [1, 0.16, 1]);
    if (t.ground === 'restored' && t.bloom >= 3 && f !== 'water') b.add('box', PALETTE.shrub[t.variant % 3], [t.x + 0.5, h + 0.2, t.z + 0.5], [0.6, 0.3, 0.6]);
  }

  /** Look of the chunk being built: prop level 0–4, and whether it's the park. */
  private level = 0;
  private inPark = false;

  private tile(b: MeshBuilder, t: TileData, h: number) {
    const x = t.x + 0.5;
    const z = t.z + 0.5;
    const f = t.feature ?? 'lawn';
    const r = new VRng(t.variant * 7919 + 13);
    const dead = DEAD[f] ?? DEAD.lawn;
    if (t.blocked) {
      b.add('box', dead[t.variant % dead.length], [x, h, z], [0.96, 0.16, 0.96]);
      if (t.feature !== 'building') this.prop(b, t.prop ?? 'stump', x, h + 0.08, z, r);
      return;
    }
    if (t.occupantId) {
      b.add('box', t.ground === 'restored' ? PALETTE.grass[t.variant % PALETTE.grass.length] : PALETTE.soil, [x, h, z], [1, 0.16, 1]);
      return;
    }
    const top = h + 0.08;
    switch (t.ground) {
      case 'polluted': {
        const shade = t.pollution > 80 ? dead[(t.variant + 1) % dead.length] : dead[t.variant % dead.length];
        b.add('box', shade, [x, h, z], [0.96, 0.16, 0.96]);
        if (f === 'road') {
          if (t.variant % 3 === 0) b.add('box', '#c9c38f', [x, top + 0.004, z], [0.12, 0.01, 0.4]);
        } else if (f === 'water') {
          b.add('box', '#3e4a43', [x, top + 0.005, z], [0.8, 0.01, 0.8]);
        } else if (this.inPark && this.level >= 1) {
          // Swept: the litter is gone, a few weeds remain; paving is scrubbed lighter.
          if (f === 'paving') b.add('box', '#b4b1a8', [x, h + 0.001, z], [0.9, 0.161, 0.9]);
          if (t.variant % 3 === 0) b.add('box', '#6d6a62', [x + r.range(-0.2, 0.2), top + 0.004, z + r.range(-0.2, 0.2)], [r.range(0.2, 0.4), 0.01, 0.03]);
          if (r.next() < 0.3) b.add('cone', '#86965f', [x + r.range(-0.3, 0.3), top + 0.05, z + r.range(-0.3, 0.3)], [0.06, 0.1, 0.06]);
        } else {
          for (let i = 0; i < 1 + (t.variant % 2); i++) b.add('box', '#5f5c55', [x + r.range(-0.25, 0.25), top + 0.004, z + r.range(-0.25, 0.25)], [r.range(0.3, 0.6), 0.01, 0.035]);
          if (r.next() < 0.4) b.add('cone', '#7d8a5c', [x + r.range(-0.3, 0.3), top + 0.05, z + r.range(-0.3, 0.3)], [0.06, 0.1, 0.06]);
          // Leaf litter: groves always, the dilapidated park until its paths are swept.
          if (f === 'litter' || this.inPark) for (let i = 0; i < (this.inPark ? 2 + (t.variant % 3) : 3); i++) b.add('sphere', ['#6b5a45', '#8a6b3f', '#7a4f32'][i % 3], [x + r.range(-0.35, 0.35), top + 0.01, z + r.range(-0.35, 0.35)], [0.16, 0.03, 0.1]);
        }
        break;
      }
      case 'prepared':
      case 'growing': {
        b.add('box', f === 'water' ? '#4f7f86' : PALETTE.soil, [x, h, z], [0.96, 0.16, 0.96]);
        const n = t.ground === 'growing' ? 5 : 3 + (t.variant % 3);
        for (let i = 0; i < n; i++) {
          const sx = x + r.range(-0.3, 0.3);
          const sz = z + r.range(-0.3, 0.3);
          if (t.ground === 'growing') b.add('cone', PALETTE.grassTuft[i % 3], [sx, top + 0.06, sz], [0.05, 0.12, 0.05]);
          else b.add('sphere', PALETTE.moss, [sx, top + 0.005, sz], [r.range(0.14, 0.26), 0.05, r.range(0.12, 0.24)]);
        }
        break;
      }
      case 'restored': {
        if (f === 'water') {
          b.add('box', ALIVE.water, [x, h - 0.02, z], [1, 0.12, 1]);
          if (t.variant % 2) b.add('cylinder', '#5fb24a', [x + r.range(-0.25, 0.25), top - 0.035, z + r.range(-0.25, 0.25)], [0.22, 0.01, 0.22]);
          if (t.bloom >= 2 && t.variant % 3 === 0) b.add('sphere', '#ff9fd0', [x + r.range(-0.2, 0.2), top - 0.02, z + r.range(-0.2, 0.2)], 0.07);
          break;
        }
        if (f === 'paving') {
          // Clean stone with a planted bed.
          b.add('box', ALIVE.paving, [x, h, z], [0.98, 0.16, 0.98]);
          b.add('box', PALETTE.grass[t.variant % PALETTE.grass.length], [x, top + 0.01, z], [0.6, 0.02, 0.6]);
        } else b.add('box', PALETTE.grass[t.variant % PALETTE.grass.length], [x, h, z], [1, 0.16, 1]);
        const tufts = f === 'paving' ? 3 : 6;
        for (let i = 0; i < tufts; i++) {
          const ht = r.range(0.09, 0.2);
          const span = f === 'paving' ? 0.25 : 0.42;
          b.add('cone', PALETTE.grassTuft[i % 3], [x + r.range(-span, span), top + ht / 2, z + r.range(-span, span)], [0.055, ht, 0.055]);
        }
        if (t.bloom >= 2)
          for (let i = 0; i < 3 + (t.variant % 2); i++) {
            const ht = r.range(0.14, 0.26);
            const fx = x + r.range(-0.32, 0.32);
            const fz = z + r.range(-0.32, 0.32);
            b.add('cylinder', PALETTE.stem, [fx, top + ht / 2, fz], [0.02, ht, 0.02]);
            b.add('sphere', PALETTE.flower[(t.variant + i) % PALETTE.flower.length], [fx, top + ht, fz], [0.11, 0.07, 0.11]);
          }
        if (t.bloom >= 3) {
          const kind = t.variant % 4;
          if (kind === 1) {
            b.add('cylinder', PALETTE.trunk, [x, top + 0.22, z], [0.07, 0.44, 0.07]);
            b.add('sphere', PALETTE.shrub[0], [x, top + 0.55, z], [0.48, 0.42, 0.48]);
            b.add('sphere', PALETTE.shrub[1], [x + 0.12, top + 0.72, z + 0.05], [0.3, 0.26, 0.3]);
          } else
            for (let i = 0; i < 3; i++) {
              const s = r.range(0.24, 0.34);
              b.add('sphere', PALETTE.shrub[i], [x + r.range(-0.15, 0.15), top + s / 2.2, z + r.range(-0.15, 0.15)], [s, s * 0.85, s]);
            }
        }
        break;
      }
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
    const wallsDead = ['#a19d93', '#9a8f80', '#8f969a', '#a8a093', '#97928a'];
    const wallsAlive = ['#f4f1e8', '#eef2ea', '#f6efe4', '#e9f1f0', '#f3f0f5'];
    const wall = (alive ? wallsAlive : wallsDead)[p.style % 5];
    b.add('box', wall, [cx, h + 0.08 + H / 2, cz], [bw, H, bd]);
    if (far) {
      b.add('box', alive ? '#7cc576' : '#7d7a73', [cx, top + 0.03, cz], [bw * 0.9, 0.06, bd * 0.9]);
      return;
    }
    // Window bands on the two faces the camera sees (south and east), one per storey.
    const glass = alive ? '#9fd6e8' : '#4b4f54';
    for (let i = 0; i < p.storeys; i++) {
      const y = h + 0.08 + CITY_GEN.buildings.storey * (i + 0.55);
      b.add('box', glass, [cx, y, p.z + p.d - 0.12 + 0.005], [bw * 0.82, CITY_GEN.buildings.storey * 0.38, 0.02]);
      b.add('box', glass, [p.x + p.w - 0.12 + 0.005, y, cz], [0.02, CITY_GEN.buildings.storey * 0.38, bd * 0.82]);
    }
    // Parapet and roof.
    b.add('box', alive ? '#e2ddd0' : '#7f7b72', [cx, top + 0.04, cz], [bw + 0.06, 0.08, bd + 0.06]);
    if (alive) {
      // A roof garden, a solar panel or two, and vines down the sunny face.
      b.add('box', '#6fbf5e', [cx, top + 0.09, cz], [bw * 0.86, 0.05, bd * 0.86]);
      const r = new VRng(p.style * 131 + p.x * 7 + p.z * 13);
      for (let i = 0; i < 1 + (p.style % 2); i++) b.add('box', PALETTE.panel, [p.x + 0.6 + i * 0.7, top + 0.2, p.z + 0.6], [0.5, 0.04, 0.4]);
      for (let i = 0; i < 3; i++) b.add('sphere', PALETTE.shrub[i % 3], [p.x + r.range(0.5, p.w - 0.5), top + 0.18, p.z + r.range(0.9, p.d - 0.4)], [0.32, 0.22, 0.32]);
      for (let i = 0; i < 2; i++) b.add('box', '#4f9a4a', [p.x + 0.4 + i * (p.w - 0.8), h + 0.08 + H * 0.5, p.z + p.d - 0.1], [0.12, H * 0.9, 0.03]);
    } else {
      // A rusty water tank or a dead antenna on the roof.
      if (p.style % 3 === 0) b.add('cylinder', '#6e655a', [p.x + 0.6, top + 0.3, p.z + 0.6], [0.4, 0.45, 0.4]);
      else b.add('box', '#5f5c55', [p.x + p.w - 0.5, top + 0.4, p.z + 0.5], [0.04, 0.7, 0.04]);
    }
  }

  /** A tree in a stone planter: bare twigs until it leafs out. */
  private planterTree(b: MeshBuilder, x: number, y: number, z: number, leafy: boolean) {
    b.add('box', leafy ? '#d8d1c0' : '#9d978a', [x, y + 0.09, z], [0.26, 0.18, 0.26]);
    b.add('cylinder', PALETTE.trunk, [x, y + 0.36, z], [0.04, 0.4, 0.04]);
    if (leafy) {
      b.add('sphere', PALETTE.shrub[0], [x, y + 0.62, z], [0.36, 0.3, 0.36]);
      b.add('sphere', PALETTE.shrub[1], [x + 0.06, y + 0.74, z - 0.04], [0.22, 0.2, 0.22]);
    } else {
      b.add('box', '#6b5a45', [x + 0.05, y + 0.58, z], [0.14, 0.02, 0.02]);
      b.add('box', '#6b5a45', [x - 0.04, y + 0.52, z + 0.03], [0.02, 0.02, 0.12]);
    }
  }

  private prop(b: MeshBuilder, prop: string, x: number, y: number, z: number, r: VRng) {
    switch (prop) {
      case 'bench': {
        const L = this.level;
        if (L >= 2) {
          // Repaired: fresh slats, green iron legs, and a planter tree beside it that leafs out at 75%.
          b.add('box', '#b9824f', [x, y + 0.18, z], [0.8, 0.05, 0.3]);
          b.add('box', '#b9824f', [x, y + 0.32, z - 0.13], [0.8, 0.2, 0.04]);
          b.add('box', '#3f7a52', [x - 0.32, y + 0.08, z], [0.05, 0.16, 0.28]);
          b.add('box', '#3f7a52', [x + 0.32, y + 0.08, z], [0.05, 0.16, 0.28]);
        } else {
          // Broken: a weathered seat sagging onto one leg, the backrest fallen behind it.
          b.add('box', '#6e5a48', [x + 0.05, y + 0.14, z], [0.8, 0.05, 0.3]);
          b.add('box', '#5f4d3d', [x - 0.05, y + 0.03, z - 0.3], [0.7, 0.04, 0.18]);
          b.add('box', '#5b5d60', [x + 0.32, y + 0.08, z], [0.05, 0.16, 0.28]);
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
        b.add('cylinder', L >= 2 ? '#e6dfcf' : '#cfc8b8', [cx, y + 0.1, cz], [1.9, 0.2, 1.9]);
        for (let i = 0; i < 6; i++) {
          if (L < 2 && i === 4) continue; // a missing column until it's repaired
          const a = (i / 6) * Math.PI * 2;
          b.add('cylinder', L >= 2 ? '#f3efe4' : '#a9a293', [cx + Math.cos(a) * 0.78, y + 0.65, cz + Math.sin(a) * 0.78], [0.07, 0.9, 0.07]);
        }
        b.add('cone', L >= 4 ? '#d2553f' : L >= 2 ? '#a8714c' : '#7d6656', [cx, y + 1.3, cz], [2.1, 0.55, 2.1]);
        b.add('sphere', L >= 2 ? '#e8c04f' : '#8f8160', [cx, y + 1.62, cz], 0.12);
        if (L >= 3) {
          // Bunting: little flags strung between the columns.
          const flags = ['#ff6f91', '#ffd25e', '#6fd3ff', '#8be06b', '#c38bff'];
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
          b.add('cylinder', '#3f4246', [x, y + 0.04, z], [0.22, 0.08, 0.22]);
          b.add('cylinder', '#4a4c50', [x, y + 0.55, z], [0.06, 1.0, 0.06]);
          b.add('box', '#4a4c50', [x, y + 1.06, z], [0.22, 0.04, 0.22]);
          b.add('sphere', '#fff1b8', [x, y + 0.96, z], 0.16);
          b.add('cylinder', '#ffe58a', [x, y + 0.002, z], [0.9, 0.004, 0.9]); // its pool of light
        } else {
          b.add('box', '#4a4c50', [x, y + 0.05, z], [0.9, 0.06, 0.08]); // toppled
          b.add('sphere', '#8d8a78', [x + 0.42, y + 0.07, z], 0.12);
        }
        break;
      case 'barrel':
        b.add('cylinder', this.level >= 2 ? '#5aa3c9' : '#6b7378', [x, y + 0.25, z], [0.4, 0.5, 0.4]);
        if (this.level >= 2) b.add('cylinder', '#7fd0f0', [x, y + 0.505, z], [0.34, 0.01, 0.34]);
        break;
      case 'bollard':
        b.add('cylinder', '#6f7175', [x, y + 0.2, z], [0.14, 0.4, 0.14]);
        break;
      case 'pillar':
        b.add('box', '#b8b4aa', [x, y + 0.45, z], [0.32, 0.9, 0.32]);
        b.add('box', '#9d998f', [x + 0.1, y + 0.95, z], [0.2, 0.12, 0.3]);
        break;
      case 'post':
        b.add('cylinder', '#5a4636', [x, y + 0.3, z], [0.12, 0.6, 0.12]);
        break;
      case 'stall':
        b.add('box', '#9a8a70', [x, y + 0.25, z], [0.8, 0.5, 0.6]);
        b.add('box', r.next() < 0.5 ? '#b5655a' : '#5a7fb5', [x, y + 0.62, z], [0.95, 0.06, 0.75]);
        break;
      case 'drain':
        b.add('box', '#3d3a35', [x, y + 0.02, z], [0.6, 0.04, 0.6]);
        break;
      default:
        b.add('cylinder', '#6b5a45', [x, y + 0.12, z], [0.36, 0.24, 0.36]);
        b.add('cylinder', '#7d6a55', [x, y + 0.25, z], [0.3, 0.02, 0.3]);
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

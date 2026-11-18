import { GROUND } from '../core/GameState';
import { rasterCurve, type AreaRaster } from '../core/RoadRaster';
import type { TileData } from '../core/types';
import { itemDef } from '../data/items';
import { PATH_MATERIAL, PATH_MATERIALS, PATHS, type PathMaterial } from '../data/paths';
import type { ItemCost } from '../data/crafting';
import type { Sim } from './Sim';

/** One path bloombot laid: points (layer cells, tile centres at .5) the curve runs through, its width, its material. */
export interface PathData {
  id: string;
  pts: [number, number][];
  /** index into PATHS.widths */
  w: number;
  mat: PathMaterial;
}

/** A Catmull-Rom curve through the points, sampled evenly enough for the decal and the tiles under it. */
export function pathCurve(pts: readonly [number, number][]): [number, number][] {
  if (pts.length < 2) return pts.map((p) => [p[0], p[1]]);
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.ceil(len * PATHS.samplesPerTile));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

/**
 * E23.6.7 (#472): paths. Bloombot lays footpaths in build mode: points the path follows on a smooth curve, a width
 * from a narrow trail to a wide promenade, and a material. A path can be reshaped (points moved, added, taken away),
 * widened, repaved or removed; removing it gives its materials back. Under the hood the curve is kept as points,
 * drawn as a ground decal (rendering/PathVisuals) and rasterised to tiles with `rasterCurve` (core/RoadRaster) for
 * walking, building and restoring: nothing is built on a path, and sprinting on one costs less charge (E23.2.1 reads
 * `onPath`).
 *
 * Depaving: breaking up old road or paving (the city's own, or the park's paths) turns it back into ground. Ground
 * still dead stays dead (and can be pulsed); restored paving becomes restored soil. Nothing ever goes back to dead.
 * Depaved tiles are saved (their feature comes from generation) and applied as each chunk loads.
 */
export class Paths {
  private index?: Map<string, string>;

  constructor(private sim: Sim) {}

  /** Every path laid, in the order they were laid. */
  all(): readonly PathData[] {
    return this.sim.state.salvage?.paths ?? [];
  }

  get(id: string): PathData | undefined {
    return this.all().find((p) => p.id === id);
  }

  /** The tiles a path covers ("x,z" keys). */
  tiles(p: Pick<PathData, 'pts' | 'w'>): AreaRaster {
    return rasterCurve(pathCurve(p.pts), PATHS.widths[p.w] ?? PATHS.widths[0]);
  }

  /** What a path of a material over these tiles costs. */
  cost(mat: PathMaterial, tiles: number): ItemCost {
    const out: ItemCost = {};
    for (const [k, v] of Object.entries(PATH_MATERIAL[mat].perTile) as [keyof ItemCost, number][]) out[k] = v * tiles;
    return out;
  }

  /** Materials known now. */
  known(): PathMaterial[] {
    return PATH_MATERIALS.filter((m) => this.sim.crafting.unlocked(m.unlock)).map((m) => m.id);
  }

  private reindex() {
    const ix = new Map<string, string>();
    for (const p of this.all()) for (const k of this.tiles(p).keys()) ix.set(k, p.id);
    this.index = ix;
  }

  /** The path on a ground tile, if any (the last laid wins where two cross). */
  pathAt(x: number, z: number): PathData | undefined {
    if (!this.index) this.reindex();
    const id = this.index!.get(`${x},${z}`);
    return id ? this.get(id) : undefined;
  }

  /** Is this ground spot on a path? (E23.2.1: sprinting on a path costs less charge.) */
  onPath(x: number, z: number): boolean {
    return !!this.pathAt(Math.floor(x), Math.floor(z));
  }

  /** Why a path can't be laid (or reshaped to this) now, if it can't. `except`: the path being reshaped. */
  problem(p: Omit<PathData, 'id'>, except?: PathData): string | undefined {
    const s = this.sim;
    if (!s.state.salvage) return 'Paths belong to the Old City';
    const def = PATH_MATERIAL[p.mat];
    if (!def) return 'Unknown path';
    if (!s.crafting.unlocked(def.unlock)) return `${def.name} is not known yet`;
    if (p.pts.length < 2) return 'Place a second point';
    if (p.pts.length > PATHS.maxPoints) return `At most ${PATHS.maxPoints} points on one path`;
    if (!except && this.all().length >= PATHS.maxPaths) return `At most ${PATHS.maxPaths} paths`;
    for (let i = 1; i < p.pts.length; i++) if (Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]) > PATHS.maxSegment) return 'Points too far apart: add one between';
    const tiles = this.tiles(p);
    for (const key of tiles.keys()) {
      const [x, z] = key.split(',').map(Number);
      const t = s.grid.get(GROUND, x, z);
      if (!t) return 'Too close to the edge';
      if (t.blocked && !t.unblocked) return 'Something is in the way';
      if (t.occupantId) return 'Something is built here';
      if (!s.areas.isClear(t) && !s.areas.canTouch(t)) return 'Lost in the fog';
      if (t.feature === 'water' && !def.overWater) return 'Only a boardwalk crosses water';
      if (def.sandOnly && t.feature !== 'sand') return 'A sand trail stays on the sand';
    }
    // what it costs, less what the path being reshaped gives back
    const need = this.cost(p.mat, tiles.size);
    if (except) {
      const back = this.cost(except.mat, this.tiles(except).size);
      for (const [k, v] of Object.entries(back) as [keyof ItemCost, number][]) need[k] = Math.max(0, (need[k] ?? 0) - v);
    }
    const short = s.inventory.shortfall(need);
    if (short) return `Needs ${short === 'biomass' ? 'Greens' : itemDef(short).name}`;
    return undefined;
  }

  private write(list: PathData[]) {
    const sv = this.sim.state.salvage!;
    if (list.length) sv.paths = list;
    else delete sv.paths;
    this.index = undefined;
  }

  /** Lays a path. Returns its id, or why not. */
  add(pts: [number, number][], w: number, mat: PathMaterial): { id?: string; why?: string } {
    const p = { pts: pts.map((q) => [q[0], q[1]] as [number, number]), w, mat };
    const why = this.problem(p);
    if (why) return { why };
    if (!this.sim.inventory.pay(this.cost(mat, this.tiles(p).size))) return { why: 'Could not pay for it' };
    const id = this.sim.newId('path');
    this.write([...this.all(), { id, ...p }]);
    this.sim.bus.emit('paths.changed', { id });
    return { id };
  }

  /** Reshapes, widens or repaves a path (pays the difference, gives back what it no longer needs). */
  change(id: string, to: Partial<Omit<PathData, 'id'>>): string | undefined {
    const old = this.get(id);
    if (!old) return 'No such path';
    const next = { pts: (to.pts ?? old.pts).map((q) => [q[0], q[1]] as [number, number]), w: to.w ?? old.w, mat: to.mat ?? old.mat };
    // the path's own tiles don't block it: check it as if it were gone
    const order = this.all().map((p) => p.id);
    const others = this.all().filter((p) => p.id !== id);
    this.write(others);
    const why = this.problem(next, old);
    if (why) {
      this.write(this.inOrder(order, [...others, old]));
      return why;
    }
    this.sim.inventory.refund(this.cost(old.mat, this.tiles(old).size));
    this.sim.inventory.pay(this.cost(next.mat, this.tiles(next).size));
    this.write(this.inOrder(order, [...others, { id, ...next }]));
    this.sim.bus.emit('paths.changed', { id });
    return undefined;
  }

  /** Paths in their lay order (draw order is lay order). */
  private inOrder(order: string[], list: PathData[]): PathData[] {
    return [...list].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  /** Removes a path; its materials come back whole. */
  remove(id: string): boolean {
    const p = this.get(id);
    if (!p) return false;
    this.write(this.all().filter((q) => q.id !== id));
    this.sim.inventory.refund(this.cost(p.mat, this.tiles(p).size));
    this.sim.bus.emit('paths.changed', { id });
    return true;
  }

  /** The point of a path nearest a spot, within `reach` tiles. */
  nearestPoint(p: PathData, x: number, z: number, reach = 1.5): number | undefined {
    let best: number | undefined;
    let bd = reach;
    p.pts.forEach((q, i) => {
      const d = Math.hypot(q[0] - x, q[1] - z);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Where on a path's point list a new point at (x, z) belongs (after the nearest segment's start). */
  insertAt(p: PathData, x: number, z: number): number {
    let best = 1;
    let bd = Infinity;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, az] = p.pts[i];
      const [bx, bz] = p.pts[i + 1];
      const dx = bx - ax, dz = bz - az;
      const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(ax + dx * k - x, az + dz * k - z);
      if (d < bd) {
        bd = d;
        best = i + 1;
      }
    }
    return best;
  }

  // ───────────── depaving ─────────────

  private get depavedSet(): Set<string> {
    return new Set(this.sim.state.salvage?.depaved ?? []);
  }

  /** Is this tile old road or paving that can be broken up? */
  canDepave(t: TileData | undefined): string | undefined {
    if (!t || t.roofId !== GROUND) return 'Only old road and paving on the ground';
    if (t.feature !== 'road' && t.feature !== 'paving') return 'Only old road and paving can be broken up';
    if (t.occupantId) return 'Something is built here';
    if (this.pathAt(t.x, t.z)) return 'A path runs here';
    return undefined;
  }

  /** Breaks up old road or paving: the ground underneath comes back (dead ground stays dead, ready to restore). */
  depave(x: number, z: number): string | undefined {
    const t = this.sim.grid.get(GROUND, x, z);
    const why = this.canDepave(t);
    if (why) return why;
    const sv = this.sim.state.salvage!;
    sv.depaved = [...this.depavedSet, `${x},${z}`].sort();
    this.apply(t!);
    this.sim.bus.emit('paths.depaved', { x, z });
    return undefined;
  }

  /** A depaved tile's ground: no road or paving left on it. */
  private apply(t: TileData) {
    t.feature = 'lawn';
    this.sim.grid.touch(t);
  }

  /** A chunk loaded: its depaved tiles lose their road or paving again (the feature comes from generation). */
  applyChunk(tiles: readonly (TileData | undefined)[]) {
    const set = this.depavedSet;
    if (!set.size) return;
    for (const t of tiles) if (t && t.roofId === GROUND && set.has(`${t.x},${t.z}`)) t.feature = 'lawn';
  }

  /** Is this tile depaved? */
  depaved(x: number, z: number): boolean {
    return this.depavedSet.has(`${x},${z}`);
  }
}

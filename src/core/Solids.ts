/**
 * E23.12.3 (#530): what stands solid in the world, as boxes, for the CPU line of sight (core/CatSight `rayClear`)
 * where the GPU sight pick can't run (WebGPU). The chunk builder reports what it draws while it draws it (a
 * primitive, a placed model at its loaded size, a tree or vine), so the boxes have the real shapes and heights the
 * player sees: buildings and their roofs, towers, trees' crowns, ruins and salvage piles, gates, walls and rails,
 * props, decorations, pergolas. Thin or low things are left out (they can't hide a cat). Pure: no PlayCanvas.
 */

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

export const SOLIDS = {
  /** a box must rise this far above the ground it stands on to count (world units; a cat is 0.32 tall) */
  minRise: 0.12,
  /** and be at least this wide on one side (posts thinner than this don't hide a cat) */
  minWidth: 0.08,
  /** foliage (trees, shrubs, vines) counts only from this tall: flowers and grass tufts don't hide a cat */
  minFoliage: 0.3,
  /**
   * or reach this far below the ground (a retaining wall down to a sunk neighbour's ground, Look 4.9): ground slabs
   * (0.16 thick) don't
   */
  minDrop: 0.3,
};

/** A geometry's extent about its own origin: the furthest any vertex is from the vertical axis, and its height range. */
export interface GeoBounds {
  r: number;
  y0: number;
  y1: number;
}

/** Bounds of a vertex buffer (`stride` floats a vertex, x y z first), as GeoBounds. */
export function geoBounds(pos: ArrayLike<number>, stride: number): GeoBounds {
  let r = 0;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 2 < pos.length; i += stride) {
    r = Math.max(r, Math.hypot(pos[i], pos[i + 2]));
    y0 = Math.min(y0, pos[i + 1]);
    y1 = Math.max(y1, pos[i + 1]);
  }
  return y1 >= y0 ? { r, y0, y1 } : { r: 0, y0: 0, y1: 0 };
}

/**
 * A tree's (or shrub's) shape as two parts: its trunk, a thin post from its foot to where the crown starts, and its
 * crown, from its real bottom up. So a cat sitting under a crown, beside the trunk, can be seen from below its edge.
 * The crown starts at the lowest vertex reaching out past `spread` of the widest reach; a shrub with leaves to the
 * ground has no trunk part.
 */
export interface FoliageShape {
  crown: GeoBounds;
  trunk?: GeoBounds;
}

export function foliageShape(pos: ArrayLike<number>, stride: number, spread = 0.35): FoliageShape {
  const all = geoBounds(pos, stride);
  if (all.r <= 0) return { crown: all };
  let bottom = all.y1;
  for (let i = 0; i + 2 < pos.length; i += stride) if (Math.hypot(pos[i], pos[i + 2]) > all.r * spread) bottom = Math.min(bottom, pos[i + 1]);
  // leaves (nearly) to the ground: one part
  if (bottom - all.y0 < 0.1 * (all.y1 - all.y0)) return { crown: all };
  let tr = 0;
  for (let i = 0; i + 2 < pos.length; i += stride) if (pos[i + 1] < bottom) tr = Math.max(tr, Math.hypot(pos[i], pos[i + 2]));
  return { crown: { r: all.r, y0: bottom, y1: all.y1 }, trunk: { r: tr, y0: all.y0, y1: bottom } };
}

/** Collects one chunk's solid boxes while it is built. `floor`: the ground top there (world y). */
export class SolidCollector {
  readonly boxes: Box[] = [];
  constructor(readonly floor: number) {}

  /** An axis-aligned primitive: centred at p, s across (unit primitives). */
  prim(p: readonly [number, number, number], s: readonly [number, number, number] | number) {
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
    this.push({ x0: p[0] - sx / 2, y0: p[1] - sy / 2, z0: p[2] - sz / 2, x1: p[0] + sx / 2, y1: p[1] + sy / 2, z1: p[2] + sz / 2 }, SOLIDS.minRise);
  }

  /** A geometry placed at (x, y, z), any turn about +y, uniform `scale`: its turned footprint's square. */
  geo(b: GeoBounds, x: number, y: number, z: number, scale: number, foliage = false) {
    const r = b.r * scale;
    this.push({ x0: x - r, y0: y + b.y0 * scale, z0: z - r, x1: x + r, y1: y + b.y1 * scale, z1: z + r }, foliage ? SOLIDS.minFoliage : SOLIDS.minRise);
  }

  /**
   * A tree or shrub at (x, y, z), uniform `scale`: its crown from its real bottom, counted when it rises
   * SOLIDS.minFoliage above the ground (flowers and grass don't), and its trunk as a thin post below it.
   */
  foliage(f: FoliageShape, x: number, y: number, z: number, scale: number) {
    const before = this.boxes.length;
    this.geo(f.crown, x, y, z, scale, true);
    // a trunk only for a crown that counted (a flower's stalk isn't a post)
    if (f.trunk && this.boxes.length > before) this.geo(f.trunk, x, y, z, scale);
  }

  /** A model placed with its own (x, z) half-extent `r` and height range, scaled per axis. */
  model(b: GeoBounds, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const r = b.r * Math.max(sx, sz);
    this.push({ x0: x - r, y0: y + b.y0 * sy, z0: z - r, x1: x + r, y1: y + b.y1 * sy, z1: z + r }, SOLIDS.minRise);
  }

  /** A raw box (a tower's bounds). */
  box(b: Box) {
    this.push(b, SOLIDS.minRise);
  }

  private push(b: Box, rise: number) {
    if (b.y1 - this.floor < rise && this.floor - b.y0 < SOLIDS.minDrop) return;
    if (Math.max(b.x1 - b.x0, b.z1 - b.z0) < SOLIDS.minWidth) return;
    this.boxes.push(b);
  }
}

/**
 * The collector the drawing code reports to right now (set only while a ground chunk's build step runs; drawing
 * code anywhere else reports nothing).
 */
export const SOLID_SINK: { current?: SolidCollector } = {};

const tileKey = (x: number, z: number) => (x + 0x8000) * 0x10000 + (z + 0x8000);

/** Every chunk's solid boxes, bucketed by the tiles they cover, for point queries along a ray. */
export class SolidIndex {
  private byTile = new Map<number, Box[]>();
  private byChunk = new Map<string, { keys: number[]; boxes: Box[] }>();

  /** Replaces a chunk's boxes (it was built or rebuilt). */
  setChunk(key: string, boxes: Box[]) {
    this.clearChunk(key);
    const keys: number[] = [];
    for (const b of boxes)
      for (let x = Math.floor(b.x0); x <= Math.floor(b.x1 - 1e-9); x++)
        for (let z = Math.floor(b.z0); z <= Math.floor(b.z1 - 1e-9); z++) {
          const k = tileKey(x, z);
          let list = this.byTile.get(k);
          if (!list) this.byTile.set(k, (list = []));
          list.push(b);
          keys.push(k);
        }
    this.byChunk.set(key, { keys, boxes });
  }

  /** Forgets a chunk's boxes (it was dropped). */
  clearChunk(key: string) {
    const old = this.byChunk.get(key);
    if (!old) return;
    const gone = new Set(old.boxes);
    for (const k of new Set(old.keys)) {
      const list = this.byTile.get(k);
      if (!list) continue;
      const keep = list.filter((b) => !gone.has(b));
      if (keep.length) this.byTile.set(k, keep);
      else this.byTile.delete(k);
    }
    this.byChunk.delete(key);
  }

  /** Is (x, y, z) inside any solid box? */
  at(x: number, y: number, z: number): boolean {
    const list = this.byTile.get(tileKey(Math.floor(x), Math.floor(z)));
    if (!list) return false;
    for (const b of list) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1) return true;
    return false;
  }

  /** How many boxes are held (for tests and the debug readout). */
  get size(): number {
    let n = 0;
    for (const c of this.byChunk.values()) n += c.boxes.length;
    return n;
  }
}

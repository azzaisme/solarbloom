import { CHUNK, hashString, tileRandom } from './Generation';

/**
 * Static area layout of the endless ground: a pure function of the seed, so every area's shape, neighbours
 * and landmark are known without saving them. Areas are made of whole 16×16 chunks: a jittered Voronoi over
 * "super-cells" of SUPER×SUPER chunks, each holding one or two seed points. The park is always chunk (0, 0).
 */
export const SUPER = 2;
export const PARK = 'park';

export interface AreaInfo {
  id: string;
  /** chunk coordinates [cx, cz] */
  chunks: [number, number][];
  /** neighbouring area ids (share a chunk edge) */
  neighbours: string[];
  /** distance band from the park, in chunks (centre to centre) */
  distance: number;
  /** landmark (Core) anchor: ground-layer cell of its 2×2 footprint */
  landmark: [number, number];
}

interface Seed {
  id: string;
  x: number; // in chunk units (continuous)
  z: number;
}

const salt = hashString('areas');

/** Seed points of one super-cell (1 or 2). */
function seedsOf(seed: number, sx: number, sz: number): Seed[] {
  const two = tileRandom(seed, salt, sx, sz, 7) < 0.45;
  const out: Seed[] = [];
  for (let k = 0; k < (two ? 2 : 1); k++)
    out.push({
      id: `a${sx}_${sz}_${k}`,
      x: sx * SUPER + 0.15 + tileRandom(seed, salt, sx, sz, 11 + k * 2) * (SUPER - 0.3),
      z: sz * SUPER + 0.15 + tileRandom(seed, salt, sx, sz, 12 + k * 2) * (SUPER - 0.3),
    });
  return out;
}

/** Cached, order-independent area lookups for one seed. */
export class AreaMap {
  private byChunk = new Map<string, string>();
  private infos = new Map<string, AreaInfo>();

  constructor(readonly seed: number) {}

  /** Area id of a ground chunk. */
  areaOfChunk(cx: number, cz: number): string {
    if (cx === 0 && cz === 0) return PARK;
    const key = `${cx},${cz}`;
    const hit = this.byChunk.get(key);
    if (hit) return hit;
    const px = cx + 0.5;
    const pz = cz + 0.5;
    const sx0 = Math.floor(cx / SUPER);
    const sz0 = Math.floor(cz / SUPER);
    let best = '';
    let bd = Infinity;
    for (let sz = sz0 - 1; sz <= sz0 + 1; sz++)
      for (let sx = sx0 - 1; sx <= sx0 + 1; sx++)
        for (const s of seedsOf(this.seed, sx, sz)) {
          const d = (s.x - px) ** 2 + (s.z - pz) ** 2;
          if (d < bd - 1e-12 || (Math.abs(d - bd) < 1e-12 && s.id < best)) {
            bd = d;
            best = s.id;
          }
        }
    this.byChunk.set(key, best);
    return best;
  }

  areaOfCell(x: number, z: number): string {
    return this.areaOfChunk(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  }

  /** Full info for an area (its chunks, neighbours, landmark). */
  info(id: string): AreaInfo {
    const hit = this.infos.get(id);
    if (hit) return hit;
    let chunks: [number, number][];
    if (id === PARK) chunks = [[0, 0]];
    else {
      const [, sxs, szs] = /^a(-?\d+)_(-?\d+)_\d$/.exec(id) ?? [];
      const sx = Number(sxs);
      const sz = Number(szs);
      chunks = [];
      // A seed's chunks lie within its own super-cell's neighbourhood.
      for (let cz = (sz - 1) * SUPER; cz < (sz + 2) * SUPER; cz++)
        for (let cx = (sx - 1) * SUPER; cx < (sx + 2) * SUPER; cx++) if (this.areaOfChunk(cx, cz) === id) chunks.push([cx, cz]);
    }
    const nb = new Set<string>();
    for (const [cx, cz] of chunks)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const o = this.areaOfChunk(cx + dx, cz + dz);
        if (o !== id) nb.add(o);
      }
    const mx = chunks.reduce((a, [cx]) => a + cx + 0.5, 0) / Math.max(1, chunks.length);
    const mz = chunks.reduce((a, [, cz]) => a + cz + 0.5, 0) / Math.max(1, chunks.length);
    // Landmark: the chunk nearest the area's centre, slightly off its middle.
    const [lcx, lcz] = chunks.reduce((b, c) => ((c[0] + 0.5 - mx) ** 2 + (c[1] + 0.5 - mz) ** 2 < (b[0] + 0.5 - mx) ** 2 + (b[1] + 0.5 - mz) ** 2 ? c : b), chunks[0] ?? [0, 0]);
    const off = id === PARK ? [7, 7] : [5 + Math.floor(tileRandom(this.seed, salt, lcx, lcz, 31) * 5), 5 + Math.floor(tileRandom(this.seed, salt, lcx, lcz, 32) * 5)];
    const info: AreaInfo = {
      id,
      chunks,
      neighbours: [...nb].sort(),
      distance: Math.round(Math.hypot(mx - 0.5, mz - 0.5)),
      landmark: [lcx * CHUNK + off[0], lcz * CHUNK + off[1]],
    };
    this.infos.set(id, info);
    return info;
  }

  /** Does this area contain the ground cell? */
  contains(id: string, x: number, z: number): boolean {
    return this.areaOfCell(x, z) === id;
  }
}

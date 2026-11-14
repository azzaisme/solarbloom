import { AREA_TYPE_LIST, AREA_TYPES, CITY_GEN, THEMES, type AreaType, type Theme } from '../data/city';
import { CHUNK, hashString, tileRandom } from './Hash';

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
  type: AreaType;
  theme: Theme;
  /** pulse cost multiplier (grows with distance, capped) */
  difficulty: number;
  /** pollution floor for its dead ground */
  pollutionFloor: number;
  landmarkKind: string;
  landmarkName: string;
  /** a rare, authored landmark (a long-term goal) */
  authored: boolean;
}

/** Shared map per seed (generation and the area system use the same cache). */
const MAPS = new Map<number, AreaMap>();
export function areaMapFor(seed: number): AreaMap {
  let m = MAPS.get(seed);
  if (!m) {
    if (MAPS.size > 8) MAPS.clear();
    m = new AreaMap(seed);
    MAPS.set(seed, m);
  }
  return m;
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
    const distance = Math.round(Math.hypot(mx - 0.5, mz - 0.5));
    const theme = this.theme(lcx, lcz);
    const type = this.typeOf(id, [...nb].sort(), theme);
    const authored = this.authoredLandmark(id, distance);
    const D = CITY_GEN.difficulty;
    const info: AreaInfo = {
      id,
      chunks,
      neighbours: [...nb].sort(),
      distance,
      landmark: [lcx * CHUNK + off[0], lcz * CHUNK + off[1]],
      type,
      theme,
      difficulty: Math.min(D.max, 1 + distance * D.perChunk),
      pollutionFloor: Math.min(D.pollutionFloorMax, distance * D.pollutionPerChunk),
      landmarkKind: authored?.kind ?? AREA_TYPES[type].landmark.kind,
      landmarkName: authored?.name ?? AREA_TYPES[type].landmark.name,
      authored: !!authored,
    };
    this.infos.set(id, info);
    return info;
  }

  /** District theme of a chunk (coarse regions, so neighbouring areas feel related). */
  theme(cx: number, cz: number): Theme {
    const n = CITY_GEN.districtChunks;
    const r = tileRandom(this.seed, salt, Math.floor(cx / n), Math.floor(cz / n), 51);
    return THEMES[Math.floor(r * THEMES.length)];
  }

  /** Weighted type pick from the theme (before the variety rule). */
  private baseType(id: string, theme: Theme, reroll = 0): AreaType {
    if (id === PARK) return 'park';
    const h = hashString(id);
    const r = tileRandom(this.seed, salt, h, reroll, 61);
    const total = AREA_TYPE_LIST.reduce((a, t) => a + AREA_TYPES[t].weights[theme], 0);
    let x = r * total;
    for (const t of AREA_TYPE_LIST) if ((x -= AREA_TYPES[t].weights[theme]) < 0) return t;
    return 'street';
  }

  /**
   * Area type with a variety rule: if it would match the base type of its first neighbour (by id), it
   * re-rolls once (never repeating that type). Depth-limited, so it stays order-independent.
   */
  private typeOf(id: string, neighbours: string[], theme: Theme): AreaType {
    if (id === PARK) return 'park';
    const t = this.baseType(id, theme);
    const first = neighbours.find((n) => n !== PARK);
    if (!first) return t;
    const fc = this.firstChunk(first);
    if (this.baseType(first, this.theme(fc[0], fc[1])) !== t) return t;
    for (let k = 1; k < 6; k++) {
      const u = this.baseType(id, theme, k);
      if (u !== t) return u;
    }
    return AREA_TYPE_LIST[(AREA_TYPE_LIST.indexOf(t) + 1) % AREA_TYPE_LIST.length];
  }

  /** A seed's own chunk (for theme lookups of neighbours without building their full info). */
  private firstChunk(id: string): [number, number] {
    const [, sxs, szs] = /^a(-?\d+)_(-?\d+)_\d$/.exec(id) ?? [];
    return [Number(sxs) * SUPER, Number(szs) * SUPER];
  }

  /** Authored landmark bands: the configured ones, then one every `authoredEvery` chunks further out. */
  private bands(): { distance: number; kind: string; name: string }[] {
    const list = [...CITY_GEN.authored];
    const last = list[list.length - 1];
    for (let d = last.distance + CITY_GEN.authoredEvery, i = 0; d <= 400; d += CITY_GEN.authoredEvery, i++) list.push({ ...CITY_GEN.authored[i % CITY_GEN.authored.length], distance: d });
    return list;
  }

  /** The area holding a band's authored landmark: at that distance, in a seeded direction. */
  authoredArea(distance: number): string {
    const a = tileRandom(this.seed, salt, distance, 0, 71) * Math.PI * 2;
    return this.areaOfChunk(Math.round(Math.cos(a) * distance), Math.round(Math.sin(a) * distance));
  }

  private authoredLandmark(id: string, distance: number) {
    if (id === PARK) return undefined;
    return this.bands().find((b) => Math.abs(b.distance - distance) <= 3 && this.authoredArea(b.distance) === id);
  }

  /** Does this area contain the ground cell? */
  contains(id: string, x: number, z: number): boolean {
    return this.areaOfCell(x, z) === id;
  }
}

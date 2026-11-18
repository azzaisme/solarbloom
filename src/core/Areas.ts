import { AREA_TYPE_LIST, AREA_TYPES, CITY_GEN, THEMES, type AreaType, type Theme } from '../data/city';
import { arterialsInChunk, runCovers } from './Arterials';
import { CHUNK, hashString, tileRandom } from './Hash';
import { ROOF_TEMPLATES } from '../data/templates';
import { OLD_CITY } from '../data/oldcity';
import { inOldCity, isSeaChunk, regionById, regionOfChunk } from './OldCityLayout';

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
  /** E21.4: an Old City area with no landmark to wake (a backstreet, the sea, the cloud beyond) */
  noLandmark?: boolean;
  /** E21.4: the Old City region this is (data/oldcity RegionId), if it is one */
  region?: string;
}

/** City 12.1: a rooftop cluster's raised roof (ground cells; a template from the old campaign). */
export interface RooftopPlan {
  template: string;
  /** ground cell under the roof's local (0, 0) */
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** roof-local cell of its Core (the area's landmark) */
  core: [number, number];
}

/** Generations that change the area layout: 2, 3 (rooftop clusters), 4 (roads: landmarks clear of arterials), 5 (E21: the Old City). */
export const genKey = (gen: number) => (gen >= 5 ? 5 : gen >= 4 ? 4 : gen >= 3 ? 3 : 2);

/** Shared map per seed and ground generation (generation and the area system use the same cache). */
const MAPS = new Map<string, AreaMap>();
export function areaMapFor(seed: number, gen = 2): AreaMap {
  const key = `${seed}|${genKey(gen)}`;
  let m = MAPS.get(key);
  if (!m) {
    if (MAPS.size > 8) MAPS.clear();
    m = genKey(gen) === 5 ? new OldCityMap(seed) : new AreaMap(seed, gen);
    MAPS.set(key, m);
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

  constructor(
    readonly seed: number,
    /** ground generation version: 3 places rooftop clusters */
    readonly gen = 2,
  ) {}

  /**
   * Area id of a ground chunk. Generation 4: an area is always one edge-connected piece. Snapping chunk centres to
   * the Voronoi can leave a seed's chunks touching only at corners; the largest piece keeps the id and each
   * detached piece joins the lowest-id neighbouring area it touches (still local and order-independent).
   */
  areaOfChunk(cx: number, cz: number): string {
    if (cx === 0 && cz === 0) return PARK;
    const key = `${cx},${cz}`;
    const hit = this.byChunk.get(key);
    if (hit) return hit;
    const raw = this.rawArea(cx, cz);
    const id = this.gen >= 4 ? (this.pieces(raw).adopt.get(key) ?? raw) : raw;
    this.byChunk.set(key, id);
    return id;
  }

  private rawCache = new Map<string, string>();
  private pieceCache = new Map<string, { main: Set<string>; rest: string[][] }>();
  private adoptCache = new Map<string, { main: Set<string>; adopt: Map<string, string> }>();

  /** A seed's raw chunks split into its main piece and the detached pieces, each joining a neighbour's main piece. */
  private pieces(id: string): { main: Set<string>; adopt: Map<string, string> } {
    const hit = this.adoptCache.get(id);
    if (hit) return hit;
    const { main, rest } = this.split(id);
    const adopt = new Map<string, string>();
    for (const part of rest) {
      const cands = new Set<string>();
      for (const c of part) {
        const [x, z] = c.split(',').map(Number);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const nz = z + dz;
          const o = this.rawArea(nx, nz);
          if (o === id) continue;
          if (o === PARK || this.split(o).main.has(`${nx},${nz}`)) cands.add(o);
        }
      }
      const to = [...cands].sort()[0];
      if (to) for (const c of part) adopt.set(c, to);
    }
    const out = { main, adopt };
    this.adoptCache.set(id, out);
    return out;
  }

  /** A seed's raw chunks (the Voronoi), as edge-connected pieces: the largest is its main piece. */
  private split(id: string): { main: Set<string>; rest: string[][] } {
    const hit = this.pieceCache.get(id);
    if (hit) return hit;
    const [sx, sz] = this.firstChunk(id).map((c) => c / SUPER);
    const raw = new Set<string>();
    for (let cz = (sz - 1) * SUPER; cz < (sz + 2) * SUPER; cz++) for (let cx = (sx - 1) * SUPER; cx < (sx + 2) * SUPER; cx++) if (this.rawArea(cx, cz) === id) raw.add(`${cx},${cz}`);
    const parts: string[][] = [];
    const seen = new Set<string>();
    for (const k of [...raw].sort()) {
      if (seen.has(k)) continue;
      const part: string[] = [];
      const stack = [k];
      seen.add(k);
      while (stack.length) {
        const c = stack.pop()!;
        part.push(c);
        const [x, z] = c.split(',').map(Number);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = `${x + dx},${z + dz}`;
          if (raw.has(n) && !seen.has(n)) seen.add(n), stack.push(n);
        }
      }
      parts.push(part.sort());
    }
    // Largest piece first; ties by its first chunk key.
    parts.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
    const out = { main: new Set(parts[0] ?? []), rest: parts.slice(1) };
    this.pieceCache.set(id, out);
    return out;
  }

  /** The Voronoi owner of a chunk, before generation 4's one-piece rule. */
  private rawArea(cx: number, cz: number): string {
    if (cx === 0 && cz === 0) return PARK;
    const key = `${cx},${cz}`;
    const hit = this.rawCache.get(key);
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
    this.rawCache.set(key, best);
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
      // A seed's chunks lie within its own super-cell's neighbourhood (plus one chunk for adopted pieces, gen 4).
      const m = this.gen >= 4 ? 1 : 0;
      for (let cz = (sz - 1) * SUPER - m; cz < (sz + 2) * SUPER + m; cz++)
        for (let cx = (sx - 1) * SUPER - m; cx < (sx + 2) * SUPER + m; cx++) if (this.areaOfChunk(cx, cz) === id) chunks.push([cx, cz]);
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
    // Generation 4: keep the landmark and its clearance off any arterial crossing its chunk.
    if (this.gen >= 4 && id !== PARK) this.clearOfArterials(lcx, lcz, off);
    const distance = Math.round(Math.hypot(mx - 0.5, mz - 0.5));
    const theme = this.theme(lcx, lcz);
    let type = this.typeOf(id, [...nb].sort(), theme);
    const authored = this.authoredLandmark(id, distance);
    // Generation 3: a few streets, plazas and markets carry a rooftop cluster instead.
    const RT = CITY_GEN.rooftops;
    if (this.gen >= 3 && !authored && distance >= RT.minDistance && RT.from.includes(type) && tileRandom(this.seed, salt, hashString(id), 0, 71) < RT.chance && (this.gen < 4 || this.roofClear(id, lcx, lcz, off))) {
      type = 'rooftops';
      // The roof must fit inside the landmark's chunk: nudge the landmark so its Core can stand over it.
      const t = ROOF_TEMPLATES[this.templateOf(id)];
      off[0] = Math.min(Math.max(off[0], t.core[0]), CHUNK - t.width + t.core[0]);
      off[1] = Math.min(Math.max(off[1], t.core[1]), CHUNK - t.depth + t.core[1]);
    }
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

  /**
   * City 12.1: the raised roof of a rooftop cluster: a campaign template placed so its Core stands exactly over
   * the area's landmark cell (so labels, the camera and the advisor need no special case). Pure.
   */
  rooftop(id: string): RooftopPlan | undefined {
    const a = this.info(id);
    if (a.type !== 'rooftops') return undefined;
    const RT = CITY_GEN.rooftops;
    const template = this.templateOf(id);
    const t = ROOF_TEMPLATES[template];
    const core: [number, number] = [t.core[0], t.core[1]];
    return { template, x: a.landmark[0] - core[0], z: a.landmark[1] - core[1], width: t.width, depth: t.depth, height: RT.height, core };
  }

  /**
   * City 16: nudge a landmark offset (chunk-local, in place) so its footprint plus clearance and a 1-tile verge stay
   * off every arterial in its chunk: the nearest offset in 2–12 on each axis that is clear.
   */
  private clearOfArterials(lcx: number, lcz: number, off: number[]) {
    const runs = arterialsInChunk(this.seed, lcx, lcz);
    const pad = CITY_GEN.landmarkClearance + 1;
    for (const [axis, i] of [['x', 1], ['z', 0]] as const) {
      // runs along x constrain the z offset (index 1), runs along z the x offset (index 0)
      const across = runs.filter((r) => r.axis === axis);
      if (!across.length) continue;
      const ok = (o: number) => across.every((r) => o + 1 + pad < r.lane || o - pad > r.lane + r.width - 1);
      let best = off[i];
      for (let d = 0; d <= 10; d++) {
        if (off[i] - d >= 2 && ok(off[i] - d)) { best = off[i] - d; break; }
        if (off[i] + d <= 12 && ok(off[i] + d)) { best = off[i] + d; break; }
      }
      off[i] = best;
    }
  }

  /** City 16: a rooftop cluster may only stand where its roof covers no arterial. */
  private roofClear(id: string, lcx: number, lcz: number, off: number[]): boolean {
    const t = ROOF_TEMPLATES[this.templateOf(id)];
    const ox = Math.min(Math.max(off[0], t.core[0]), CHUNK - t.width + t.core[0]);
    const oz = Math.min(Math.max(off[1], t.core[1]), CHUNK - t.depth + t.core[1]);
    const x0 = lcx * CHUNK + ox - t.core[0];
    const z0 = lcz * CHUNK + oz - t.core[1];
    const runs = arterialsInChunk(this.seed, lcx, lcz);
    for (let z = z0; z < z0 + t.depth; z++) for (let x = x0; x < x0 + t.width; x++) if (runs.some((r) => runCovers(r, x, z))) return false;
    return true;
  }

  private templateOf(id: string): string {
    const T = CITY_GEN.rooftops.templates;
    return T[Math.floor(tileRandom(this.seed, salt, hashString(id), 1, 73) * T.length)];
  }

  /** Is a ground cell under this area's rooftop? */
  underRoof(id: string, x: number, z: number): boolean {
    const r = this.rooftop(id);
    return !!r && x >= r.x && z >= r.z && x < r.x + r.width && z < r.z + r.depth;
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

// ───────────── E21.4: the Old City ─────────────

/** E21.4: the sea's area id (every sea chunk of the Old City). */
export const SEA = 'sea';

/**
 * E21.4 (generation 5): the Old City's fixed map. Chunks −6…6 hold the park (0, 0), the nine regions from
 * data/oldcity, the sea (z ≥ 3, x ≤ 1) and backstreets (every other land chunk, one area each). Beyond is the
 * cloud wall: one-chunk areas that stay hidden until the finale. The same for every seed.
 */
export class OldCityMap extends AreaMap {
  private oc = new Map<string, AreaInfo>();

  constructor(seed: number) {
    super(seed, 5);
  }

  areaOfChunk(cx: number, cz: number): string {
    if (cx === 0 && cz === 0) return PARK;
    if (!inOldCity(cx, cz)) return `out_${cx}_${cz}`;
    if (isSeaChunk(cx, cz)) return SEA;
    const r = regionOfChunk(cx, cz);
    return r ? r.id : `bs_${cx}_${cz}`;
  }

  /** Every chunk of an area. */
  private chunksOf(id: string): [number, number][] {
    if (id === PARK) return [[0, 0]];
    const out: [number, number][] = [];
    const r = regionById(id);
    if (r) {
      for (let cz = r.chunks.z0; cz <= r.chunks.z1; cz++) for (let cx = r.chunks.x0; cx <= r.chunks.x1; cx++) out.push([cx, cz]);
      return out;
    }
    if (id === SEA) {
      for (let cz = OLD_CITY.seaMinZ; cz <= OLD_CITY.max; cz++) for (let cx = OLD_CITY.min; cx <= OLD_CITY.seaMaxX; cx++) out.push([cx, cz]);
      return out;
    }
    const m = /^(?:bs|out)_(-?\d+)_(-?\d+)$/.exec(id);
    return m ? [[Number(m[1]), Number(m[2])]] : [[0, 0]];
  }

  info(id: string): AreaInfo {
    const hit = this.oc.get(id);
    if (hit) return hit;
    const chunks = this.chunksOf(id);
    const nb = new Set<string>();
    for (const [cx, cz] of chunks)
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const o = this.areaOfChunk(cx + dx, cz + dz);
        if (o !== id) nb.add(o);
      }
    const r = regionById(id);
    const mx = chunks.reduce((a, [cx]) => a + cx + 0.5, 0) / chunks.length;
    const mz = chunks.reduce((a, [, cz]) => a + cz + 0.5, 0) / chunks.length;
    const ring = r?.ring ?? 1;
    const mult = { 1: 1, 2: 1.2, 3: 1.4 }[ring] ?? 1;
    const type: AreaType = id === PARK ? 'park' : r ? r.type : id === SEA ? 'beach' : 'street';
    const centre: [number, number] = [Math.floor(mx * CHUNK) - 1, Math.floor(mz * CHUNK) - 1];
    const info: AreaInfo = {
      id,
      chunks,
      neighbours: [...nb].sort(),
      distance: Math.round(Math.hypot(mx - 0.5, mz - 0.5)),
      landmark: id === PARK ? [7, 7] : r ? [r.landmark.x, r.landmark.z] : centre,
      type,
      theme: 'oldtown',
      difficulty: mult,
      pollutionFloor: (ring - 1) * 10,
      landmarkKind: id === PARK ? 'fountain' : r ? r.landmark.kind : '',
      landmarkName: id === PARK ? 'Dry Fountain' : r ? r.landmark.name : '',
      authored: false,
      noLandmark: id !== PARK && !r ? true : undefined,
      region: r?.id,
    };
    this.oc.set(id, info);
    return info;
  }

  rooftop(): RooftopPlan | undefined {
    return undefined;
  }

  underRoof(): boolean {
    return false;
  }

  theme(): Theme {
    return 'oldtown';
  }

  authoredArea(): string {
    return '';
  }
}

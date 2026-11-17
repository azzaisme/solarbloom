import { CITY_GEN, PARK_LAYOUT } from '../data/city';
import { PLOT_GEN } from '../data/cozy';
import { areaMapFor, genKey, PARK } from './Areas';
import { distToFootprintRaw } from './Footprint';
import { generateTile } from './Generation';
import { CHUNK, hashString, tileRandom } from './Hash';
import type { LayerData } from './types';

/**
 * E19.1.1 (#247): plot spots. Every area has 2–4 square spots of free ground the player decides the look of.
 * They are a pure function of the seed and the ground generation (never saved): only the player's choice per
 * plot is saved, sparsely, by plot id (`GameState.cozy`).
 *
 * A spot is never on roads, canals or other water, buildings, obstacles, the landmark and its clearance, under a
 * rooftop cluster, on the park's paths and starting tiles, or on an area's boundary row (its dressing lives
 * there). Spots keep a tile of space between them and stay inside one chunk, so each is drawn with its chunk.
 * E17's staged-project spots don't exist yet: when they do, `reserved` below must exclude them.
 */
export interface PlotSpot {
  /** stable id: `p<x>_<z>` (its north-west ground cell) */
  id: string;
  areaId: string;
  /** ground cell of its north-west corner; the spot covers size × size cells */
  x: number;
  z: number;
  size: number;
  /** a water cell touches its edge (for options like the mooring) */
  water: boolean;
}

const salt = hashString('plots');
const CACHE = new Map<string, PlotSpot[]>();

const plotId = (x: number, z: number) => `p${x}_${z}`;

/** Parses a plot id back to its north-west cell. */
export function plotCell(id: string): [number, number] | undefined {
  const m = /^p(-?\d+)_(-?\d+)$/.exec(id);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** A minimal ground layer for generation lookups (generation reads only its id and version). */
function groundLayer(gen: number): LayerData {
  return { id: 'g', name: 'ground', kind: 'ground', width: 0, depth: 0, height: 0, origin: [0, 0, 0], unlocked: true, preview: false, gen };
}

/** Is this ground cell free for a plot (before play: its generated look)? */
function freeCell(seed: number, layer: LayerData, areaId: string, x: number, z: number): boolean {
  const map = areaMapFor(seed, layer.gen ?? 1);
  if (map.areaOfCell(x, z) !== areaId) return false;
  const t = generateTile(seed, layer, x, z);
  if (!t || t.blocked || t.prop) return false;
  if (t.feature !== 'lawn' && t.feature !== 'paving' && t.feature !== 'clay' && t.feature !== 'litter') return false;
  const a = map.info(areaId);
  if (distToFootprintRaw(x, z, a.landmark[0], a.landmark[1], 2) <= CITY_GEN.landmarkClearance + 1) return false;
  if (map.underRoof(areaId, x, z)) return false;
  if (areaId === PARK) {
    const L = PARK_LAYOUT;
    if (t.feature === 'paving') return false; // the plaza and its winding walks
    const start = [L.starterSolar, ...L.prepared];
    if (start.some(([sx, sz]) => Math.abs(sx - x) <= 1 && Math.abs(sz - z) <= 1)) return false;
    for (const p of L.pergolas) if (x >= p.x - 1 && x <= p.x + p.w && z >= p.z - 1 && z <= p.z + p.d) return false;
  }
  return !reserved(seed, x, z);
}

/** E17 (staged houses and towers) will keep its own spots: none exist yet. */
function reserved(_seed: number, _x: number, _z: number): boolean {
  return false;
}

/** The plot spots of one area, in a stable order. Pure and cached. */
export function plotSpots(seed: number, areaId: string, gen = 2): PlotSpot[] {
  const key = `${seed}|${genKey(gen)}|${gen}|${areaId}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const map = areaMapFor(seed, gen);
  const info = map.info(areaId);
  const layer = groundLayer(gen);
  const S = PLOT_GEN.size;
  const want = areaId === PARK ? PLOT_GEN.min : Math.min(PLOT_GEN.max, PLOT_GEN.min + Math.floor(info.chunks.length / PLOT_GEN.chunksPerExtra));
  const chunks = [...info.chunks].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: PlotSpot[] = [];
  const freeCache = new Map<number, boolean>();
  const free = (x: number, z: number) => {
    const k = (x + 0x8000) * 0x10000 + (z + 0x8000);
    let v = freeCache.get(k);
    if (v === undefined) freeCache.set(k, (v = freeCell(seed, layer, areaId, x, z)));
    return v;
  };
  const fits = (x: number, z: number) => {
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) if (!free(x + i, z + j)) return false;
    // a tile of space from every other plot
    return out.every((p) => x + S < p.x || p.x + p.size < x || z + S < p.z || p.z + p.size < z);
  };
  const take = (x: number, z: number) => {
    let water = false;
    for (let i = -1; i <= S && !water; i++)
      for (let j = -1; j <= S && !water; j++) {
        if (i >= 0 && i < S && j >= 0 && j < S) continue;
        if ((i < 0 || i >= S) && (j < 0 || j >= S)) continue; // corners don't count
        if (generateTile(seed, layer, x + i, z + j)?.feature === 'water') water = true;
      }
    out.push({ id: plotId(x, z), areaId, x, z, size: S, water });
  };
  // Seeded tries, round-robin over the area's chunks; a spot sits a tile in from its chunk's edge.
  const span = CHUNK - S - 1;
  const ah = hashString(areaId);
  for (let k = 0; k < PLOT_GEN.tries && out.length < want && chunks.length; k++) {
    const [cx, cz] = chunks[k % chunks.length];
    const x = cx * CHUNK + 1 + Math.floor(tileRandom(seed, salt, ah, k, 1) * span);
    const z = cz * CHUNK + 1 + Math.floor(tileRandom(seed, salt, ah, k, 2) * span);
    if (fits(x, z)) take(x, z);
  }
  // Crowded areas: a full scan, so every area that has room gets at least the minimum.
  if (out.length < PLOT_GEN.min)
    for (const [cx, cz] of chunks)
      for (let lz = 1; lz <= span && out.length < PLOT_GEN.min; lz++)
        for (let lx = 1; lx <= span && out.length < PLOT_GEN.min; lx++) {
          const x = cx * CHUNK + lx;
          const z = cz * CHUNK + lz;
          if (fits(x, z)) take(x, z);
        }
  if (CACHE.size > 4096) CACHE.clear();
  CACHE.set(key, out);
  return out;
}

/** Plot spots whose cells lie in one ground chunk (each spot lies in exactly one). */
export function plotsInChunk(seed: number, cx: number, cz: number, gen = 2): PlotSpot[] {
  const map = areaMapFor(seed, gen);
  return plotSpots(seed, map.areaOfChunk(cx, cz), gen).filter((p) => Math.floor(p.x / CHUNK) === cx && Math.floor(p.z / CHUNK) === cz);
}

/** The plot covering a ground cell, if any. */
export function plotAt(seed: number, x: number, z: number, gen = 2): PlotSpot | undefined {
  return plotsInChunk(seed, Math.floor(x / CHUNK), Math.floor(z / CHUNK), gen).find((p) => x >= p.x && x < p.x + p.size && z >= p.z && z < p.z + p.size);
}

/** A plot by id (its area is found from its cell). */
export function plotById(seed: number, id: string, gen = 2): PlotSpot | undefined {
  const c = plotCell(id);
  return c ? plotAt(seed, c[0], c[1], gen) : undefined;
}

import { CHUNK, generateTile, tileId } from './Generation';
import type { LayerData, MachineData, TileData } from './types';

export { tileId };
export const chunkKey = (layerId: string, cx: number, cz: number) => `${layerId}|${cx}|${cz}`;
export const chunkOf = (v: number) => Math.floor(v / CHUNK);

export const ORTHO: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Manhattan distance from a cell to the nearest cell of a square footprint. */
export function distToFootprint(x: number, z: number, fx: number, fz: number, size: number): number {
  const dx = x < fx ? fx - x : x > fx + size - 1 ? x - (fx + size - 1) : 0;
  const dz = z < fz ? fz - z : z > fz + size - 1 ? z - (fz + size - 1) : 0;
  return dx + dz;
}

/** Outward direction of the edge a tile sits on in a bounded layer. */
export function edgeDir(roof: Pick<LayerData, 'width' | 'depth'>, x: number, z: number): [number, number] {
  if (x === roof.width - 1) return [1, 0];
  if (x === 0) return [-1, 0];
  if (z === roof.depth - 1) return [0, 1];
  return [0, -1];
}

/** Layer-local point where a link's relay pylon stands (just outside the edge tile). */
export function relayLocal(roof: Pick<LayerData, 'width' | 'depth'>, tile: [number, number]): [number, number] {
  const [dx, dz] = edgeDir(roof, tile[0], tile[1]);
  return [tile[0] + 0.5 + dx * 0.62, tile[1] + 0.5 + dz * 0.62];
}

export interface Chunk {
  key: string;
  layer: string;
  cx: number;
  cz: number;
  /** CHUNK×CHUNK, row-major by local z then x; undefined outside a bounded layer. */
  tiles: (TileData | undefined)[];
  /** Something in it changed since it was last packed for a save. */
  dirty: boolean;
  /** Cached packed save string (see TilePack). '' = identical to generation. */
  packed?: string;
}

/**
 * The world: layers of tiles in CHUNK×CHUNK chunks, generated on demand from the seed. Holds the tiles
 * (the canonical tile state) plus indexes; game rules live in the gameplay systems.
 * Lookups (get, neighbours, tilesNear, machinesNear) cost the same however big the world grows.
 */
export class Grid {
  private layers = new Map<string, LayerData>();
  private chunks = new Map<string, Chunk>();
  private boundedTiles = new Map<string, TileData[]>();
  /** machine ids by chunk key, for every chunk a footprint touches */
  private machineIndex = new Map<string, MachineData[]>();
  /** Called once per newly generated chunk (Sim uses it to apply saved deltas and occupancy). */
  onChunkCreated?: (c: Chunk) => void;
  /**
   * Saved deltas for chunks not generated yet (a big city loads lazily). Consumed as chunks generate,
   * and written back unchanged by a save until then.
   */
  pending: Record<string, string> = {};

  constructor(
    readonly seed: number,
    layers: LayerData[],
  ) {
    for (const l of layers) this.layers.set(l.id, l);
  }

  // ───────────── layers ─────────────

  layer(id: string): LayerData | undefined {
    return this.layers.get(id);
  }

  /** Alias kept for rooftop-era callers. */
  roof(id: string): LayerData | undefined {
    return this.layers.get(id);
  }

  get allLayers(): LayerData[] {
    return [...this.layers.values()];
  }

  /** Bounded (raised) layers: the rooftops. */
  get rooftops(): LayerData[] {
    return this.allLayers.filter((l) => l.kind === 'raised');
  }

  /** Revealed and reachable: tiles can be restored and built on. */
  isPlayable(id: string): boolean {
    const r = this.layers.get(id);
    return !!r && r.unlocked && !r.preview;
  }

  inBounds(layerId: string, x: number, z: number): boolean {
    const l = this.layers.get(layerId);
    if (!l) return false;
    return l.kind === 'ground' || (x >= 0 && z >= 0 && x < l.width && z < l.depth);
  }

  // ───────────── chunks & tiles ─────────────

  /** The chunk containing a cell, generated if needed. */
  chunkAt(layerId: string, cx: number, cz: number): Chunk | undefined {
    const key = chunkKey(layerId, cx, cz);
    let c = this.chunks.get(key);
    if (c) return c;
    const l = this.layers.get(layerId);
    if (!l) return undefined;
    if (l.kind === 'raised' && (cx < 0 || cz < 0 || cx * CHUNK >= l.width || cz * CHUNK >= l.depth)) return undefined;
    const tiles: (TileData | undefined)[] = new Array(CHUNK * CHUNK);
    for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) tiles[lz * CHUNK + lx] = generateTile(this.seed, l, cx * CHUNK + lx, cz * CHUNK + lz);
    c = { key, layer: layerId, cx, cz, tiles, dirty: false };
    this.chunks.set(key, c);
    this.onChunkCreated?.(c);
    return c;
  }

  /** Chunks generated so far (optionally only one layer's). */
  loadedChunks(layerId?: string): Chunk[] {
    const out: Chunk[] = [];
    for (const c of this.chunks.values()) if (!layerId || c.layer === layerId) out.push(c);
    return out;
  }

  get(layerId: string, x: number, z: number): TileData | undefined {
    if (!this.inBounds(layerId, x, z)) return undefined;
    const c = this.chunkAt(layerId, Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    return c?.tiles[(z - c.cz * CHUNK) * CHUNK + (x - c.cx * CHUNK)];
  }

  /** A tile only if its chunk is already generated (never generates). */
  peek(layerId: string, x: number, z: number): TileData | undefined {
    const c = this.chunks.get(chunkKey(layerId, Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    return c?.tiles[(z - c.cz * CHUNK) * CHUNK + (x - c.cx * CHUNK)];
  }

  byTileId(id: string): TileData | undefined {
    const i = id.lastIndexOf(':');
    const j = id.lastIndexOf(':', i - 1);
    if (i < 0 || j < 0) return undefined;
    return this.get(id.slice(0, j), Number(id.slice(j + 1, i)), Number(id.slice(i + 1)));
  }

  /** Every tile of a bounded layer (cached); for the unbounded ground, only tiles generated so far. */
  tilesOf(layerId: string): TileData[] {
    const l = this.layers.get(layerId);
    if (!l) return [];
    if (l.kind === 'raised') {
      let list = this.boundedTiles.get(layerId);
      if (!list) {
        list = [];
        for (let z = 0; z < l.depth; z++) for (let x = 0; x < l.width; x++) list.push(this.get(layerId, x, z)!);
        this.boundedTiles.set(layerId, list);
      }
      return list;
    }
    const out: TileData[] = [];
    for (const c of this.chunks.values()) if (c.layer === layerId) for (const t of c.tiles) if (t) out.push(t);
    return out;
  }

  /** Marks a tile's chunk as changed (needed for saving). Call after mutating any saved tile field. */
  touch(t: TileData) {
    const c = this.chunks.get(chunkKey(t.roofId, Math.floor(t.x / CHUNK), Math.floor(t.z / CHUNK)));
    if (c) c.dirty = true;
    this.onTouch?.(t);
  }
  /** Observers of tile changes (area progress caches). */
  onTouch?: (t: TileData) => void;

  neighbors(t: TileData): TileData[] {
    const out: TileData[] = [];
    for (const [dx, dz] of ORTHO) {
      const n = this.get(t.roofId, t.x + dx, t.z + dz);
      if (n) out.push(n);
    }
    return out;
  }

  footprint(layerId: string, x: number, z: number, size: number): (TileData | undefined)[] {
    const out: (TileData | undefined)[] = [];
    for (let dz = 0; dz < size; dz++) for (let dx = 0; dx < size; dx++) out.push(this.get(layerId, x + dx, z + dz));
    return out;
  }

  /** Tiles within Manhattan `radius` of a footprint (footprint excluded), visited in O(r²). */
  tilesNear(m: Pick<MachineData, 'roofId' | 'x' | 'z' | 'size'>, radius: number): TileData[] {
    const out: TileData[] = [];
    for (let z = m.z - radius; z <= m.z + m.size - 1 + radius; z++)
      for (let x = m.x - radius; x <= m.x + m.size - 1 + radius; x++) {
        const d = distToFootprint(x, z, m.x, m.z, m.size);
        if (d === 0 || d > radius) continue;
        const t = this.get(m.roofId, x, z);
        if (t) out.push(t);
      }
    return out;
  }

  /** Tiles within Manhattan `radius` of a footprint, the footprint included, row by row (z, then x). */
  tilesInRange(m: Pick<MachineData, 'roofId' | 'x' | 'z' | 'size'>, radius: number): TileData[] {
    const out: TileData[] = [];
    for (let z = m.z - radius; z <= m.z + m.size - 1 + radius; z++)
      for (let x = m.x - radius; x <= m.x + m.size - 1 + radius; x++) {
        if (distToFootprint(x, z, m.x, m.z, m.size) > radius) continue;
        const t = this.get(m.roofId, x, z);
        if (t) out.push(t);
      }
    return out;
  }

  /** Layers that are revealed and reachable. */
  playableLayers(): LayerData[] {
    return this.allLayers.filter((l) => this.isPlayable(l.id));
  }

  /** Every tile on every playable layer (bounded layers fully, the ground as far as generated). */
  playableTiles(): TileData[] {
    return this.playableLayers().flatMap((l) => this.tilesOf(l.id));
  }

  /** Tiles within Manhattan `radius` of a cell (the cell included), in O(r²). */
  tilesWithin(layerId: string, cx: number, cz: number, radius: number): TileData[] {
    const out: TileData[] = [];
    for (let z = cz - radius; z <= cz + radius; z++)
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (Math.abs(x - cx) + Math.abs(z - cz) > radius) continue;
        const t = this.get(layerId, x, z);
        if (t) out.push(t);
      }
    return out;
  }

  // ───────────── machine index ─────────────

  private footprintChunks(m: Pick<MachineData, 'roofId' | 'x' | 'z' | 'size'>): string[] {
    const keys = new Set<string>();
    for (let dz = 0; dz < m.size; dz++) for (let dx = 0; dx < m.size; dx++) keys.add(chunkKey(m.roofId, Math.floor((m.x + dx) / CHUNK), Math.floor((m.z + dz) / CHUNK)));
    return [...keys];
  }

  indexMachine(m: MachineData) {
    for (const k of this.footprintChunks(m)) {
      const list = this.machineIndex.get(k);
      if (list) {
        if (!list.includes(m)) list.push(m);
      } else this.machineIndex.set(k, [m]);
    }
  }

  /** Machines whose footprint touches a chunk. */
  machinesInChunk(key: string): MachineData[] {
    return this.machineIndex.get(key) ?? [];
  }

  unindexMachine(m: MachineData) {
    for (const k of this.footprintChunks(m)) {
      const list = this.machineIndex.get(k);
      if (list) this.machineIndex.set(k, list.filter((x) => x !== m));
    }
  }

  /**
   * Machines whose footprint lies within Manhattan `radius` of a cell (radius 0 = on it), in index order
   * (the order they were built), which keeps chain processing deterministic.
   */
  machinesNear(layerId: string, x: number, z: number, radius: number): MachineData[] {
    const reach = radius + 3; // largest footprint is 2×2; one chunk ring is always enough for small radii
    const seen = new Set<MachineData>();
    for (let cz = Math.floor((z - reach) / CHUNK); cz <= Math.floor((z + reach) / CHUNK); cz++)
      for (let cx = Math.floor((x - reach) / CHUNK); cx <= Math.floor((x + reach) / CHUNK); cx++) {
        const list = this.machineIndex.get(chunkKey(layerId, cx, cz));
        if (!list) continue;
        for (const m of list) if (!seen.has(m) && distToFootprint(x, z, m.x, m.z, m.size) <= radius) seen.add(m);
      }
    return [...seen].sort((a, b) => machineOrder(a) - machineOrder(b));
  }

  // ───────────── world space ─────────────

  /** World position of a tile centre (top surface). */
  tileWorld(t: TileData): [number, number, number] {
    const r = this.layers.get(t.roofId)!;
    return [r.origin[0] + t.x + 0.5, r.origin[1] + r.height, r.origin[2] + t.z + 0.5];
  }

  /** Converts a world-space point on a layer's plane into an integer cell. */
  worldToCell(layerId: string, wx: number, wz: number): { x: number; z: number } {
    const r = this.layers.get(layerId)!;
    return { x: Math.floor(wx - r.origin[0]), z: Math.floor(wz - r.origin[2]) };
  }
}

/** Machines are created with increasing numeric ids (`m12`); that is their build order. */
function machineOrder(m: MachineData): number {
  const n = Number(m.id.slice(1));
  return Number.isFinite(n) ? n : 0;
}

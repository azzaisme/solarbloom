import type { MachineData, RooftopData, TileData } from './types';

export const tileId = (roofId: string, x: number, z: number) => `${roofId}:${x}:${z}`;

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

/** Fast lookups over the canonical rooftop data. Holds no state of its own besides indexes. */
export class Grid {
  private byId = new Map<string, TileData>();
  private roofs = new Map<string, RooftopData>();

  constructor(rooftops: RooftopData[]) {
    for (const r of rooftops) {
      this.roofs.set(r.id, r);
      for (const t of r.tiles) this.byId.set(t.id, t);
    }
  }

  roof(id: string): RooftopData | undefined {
    return this.roofs.get(id);
  }

  /** Revealed and reachable: tiles can be restored and built on. */
  isPlayable(roofId: string): boolean {
    const r = this.roofs.get(roofId);
    return !!r && r.unlocked && !r.preview;
  }

  get rooftops(): RooftopData[] {
    return [...this.roofs.values()];
  }

  get(roofId: string, x: number, z: number): TileData | undefined {
    return this.byId.get(tileId(roofId, x, z));
  }

  byTileId(id: string): TileData | undefined {
    return this.byId.get(id);
  }

  inBounds(roofId: string, x: number, z: number): boolean {
    const r = this.roofs.get(roofId);
    return !!r && x >= 0 && z >= 0 && x < r.width && z < r.depth;
  }

  neighbors(t: TileData): TileData[] {
    const out: TileData[] = [];
    for (const [dx, dz] of ORTHO) {
      const n = this.get(t.roofId, t.x + dx, t.z + dz);
      if (n) out.push(n);
    }
    return out;
  }

  footprint(roofId: string, x: number, z: number, size: number): (TileData | undefined)[] {
    const out: (TileData | undefined)[] = [];
    for (let dz = 0; dz < size; dz++) for (let dx = 0; dx < size; dx++) out.push(this.get(roofId, x + dx, z + dz));
    return out;
  }

  /** Tiles within Manhattan `radius` of a machine footprint (footprint excluded). */
  tilesNear(m: Pick<MachineData, 'roofId' | 'x' | 'z' | 'size'>, radius: number): TileData[] {
    const r = this.roofs.get(m.roofId);
    if (!r) return [];
    const out: TileData[] = [];
    for (const t of r.tiles) {
      const d = distToFootprint(t.x, t.z, m.x, m.z, m.size);
      if (d > 0 && d <= radius) out.push(t);
    }
    return out;
  }

  /** World position of a tile centre (top surface). */
  tileWorld(t: TileData): [number, number, number] {
    const r = this.roofs.get(t.roofId)!;
    return [r.origin[0] + t.x + 0.5, r.origin[1] + r.height, r.origin[2] + t.z + 0.5];
  }

  /** Converts a world-space point on a roof's plane into integer grid cell. */
  worldToCell(roofId: string, wx: number, wz: number): { x: number; z: number } {
    const r = this.roofs.get(roofId)!;
    return { x: Math.floor(wx - r.origin[0]), z: Math.floor(wz - r.origin[2]) };
  }
}

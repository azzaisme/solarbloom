import { KEEPERS, OLD_CITY, PARK_SET, REGIONS, type GateDef, type KeeperDef, type PileDef, type RegionDef, type RegionId } from '../data/oldcity';

/**
 * E21: the Old City's fixed layout as lookups, built once from data/oldcity (pure, no seed: the Old City is the
 * same in every game). Generation stamps these set pieces over the generated ground; the systems ask what
 * stands on a cell.
 */

export type SetPiece =
  | { kind: 'pile'; pile: PileDef }
  | { kind: 'keeper'; keeper: KeeperDef }
  | { kind: 'gate'; gate: GateDef; region: RegionDef }
  | { kind: 'cache'; id: string; region: RegionId }
  | { kind: 'page'; id: string; region?: RegionId }
  | { kind: 'lookout'; id: string; region: RegionId }
  | { kind: 'shed' };

const key = (x: number, z: number) => `${x},${z}`;

let pieces: Map<string, SetPiece> | undefined;
let piles: Map<string, PileDef> | undefined;

function build() {
  pieces = new Map();
  piles = new Map();
  const put = (x: number, z: number, p: SetPiece) => pieces!.set(key(x, z), p);
  for (const p of PARK_SET.piles) {
    put(p.x, p.z, { kind: 'pile', pile: p });
    piles.set(p.id, p);
  }
  for (const pg of PARK_SET.pages) put(pg.x, pg.z, { kind: 'page', id: pg.id });
  const sh = PARK_SET.shed;
  for (let dz = 0; dz < sh.size; dz++) for (let dx = 0; dx < sh.size; dx++) put(sh.x + dx, sh.z + dz, { kind: 'shed' });
  for (const r of REGIONS) {
    for (const p of r.piles) {
      put(p.x, p.z, { kind: 'pile', pile: p });
      piles.set(p.id, p);
    }
    for (const [x, z] of r.gate.cells) put(x, z, { kind: 'gate', gate: r.gate, region: r });
    for (const c of r.caches) put(c.x, c.z, { kind: 'cache', id: c.id, region: r.id });
    for (const c of r.pages) put(c.x, c.z, { kind: 'page', id: c.id, region: r.id });
    put(r.lookout.x, r.lookout.z, { kind: 'lookout', id: r.lookout.id, region: r.id });
  }
  for (const k of KEEPERS) put(k.x, k.z, { kind: 'keeper', keeper: k });
}

/** What set piece stands on a ground cell, if any. */
export function setPieceAt(x: number, z: number): SetPiece | undefined {
  if (!pieces) build();
  return pieces!.get(key(x, z));
}

/** A pile by id. */
export function pileById(id: string): PileDef | undefined {
  if (!piles) build();
  return piles!.get(id);
}

/** Every pile in the Old City (park first, then the regions in map order). */
export function allPiles(): PileDef[] {
  if (!piles) build();
  return [...piles!.values()];
}

// ───────────── the map ─────────────

/** Is this chunk inside the Old City (chunks −6…6)? */
export function inOldCity(cx: number, cz: number): boolean {
  return cx >= OLD_CITY.min && cx <= OLD_CITY.max && cz >= OLD_CITY.min && cz <= OLD_CITY.max;
}

/** Is this Old City chunk sea? */
export function isSeaChunk(cx: number, cz: number): boolean {
  return inOldCity(cx, cz) && cz >= OLD_CITY.seaMinZ && cx <= OLD_CITY.seaMaxX;
}

/** The region a chunk belongs to (undefined for the park, backstreets, the sea and anything outside). */
export function regionOfChunk(cx: number, cz: number): RegionDef | undefined {
  for (const r of REGIONS) if (cx >= r.chunks.x0 && cx <= r.chunks.x1 && cz >= r.chunks.z0 && cz <= r.chunks.z1) return r;
  return undefined;
}

export function regionById(id: string): RegionDef | undefined {
  return REGIONS.find((r) => r.id === id);
}

export function keeperById(id: string): KeeperDef | undefined {
  return KEEPERS.find((k) => k.id === id);
}

/** The region whose cell this is. */
export function regionOfCell(x: number, z: number): RegionDef | undefined {
  return regionOfChunk(Math.floor(x / 16), Math.floor(z / 16));
}

/** Is the cell inside a rectangle? */
export function inRect(r: { x: number; z: number; w: number; d: number }, x: number, z: number): boolean {
  return x >= r.x && z >= r.z && x < r.x + r.w && z < r.z + r.d;
}

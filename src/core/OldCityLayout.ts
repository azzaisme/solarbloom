import { chunkPiles, chunkRuins, isMainlandCell, mainlandPileById, mainlandShore, onCauseway, type RuinDef } from './Mainland';
import { COAST, KEEPERS, LANDING, OLD_CITY, PARK_SET, REGIONS, type GateDef, type KeeperDef, type PileDef, type RegionDef, type RegionId, type WaterRect } from '../data/oldcity';

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
  | { kind: 'shed' }
  | { kind: 'ruin'; ruin: RuinDef };

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
  return pieces!.get(key(x, z)) ?? mainlandPiece(x, z);
}

/** A pile by id. */
export function pileById(id: string): PileDef | undefined {
  if (!piles) build();
  return piles!.get(id) ?? mainlandPileById(id);
}

/** E23.8.3.1: the mainland's set pieces are its salvage fields, generated per chunk (core/Mainland), and the ruins round its steel. */
const mlPieces = new Map<number, (SetPiece | undefined)[]>();

/** A mainland cell's set piece, from its chunk's table (built once: generation asks every cell and its neighbours). */
function mainlandPiece(x: number, z: number): SetPiece | undefined {
  if (!isMainlandCell(x)) return undefined;
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  const k = cx * 65536 + cz;
  let a = mlPieces.get(k);
  if (!a) {
    if (mlPieces.size > 4096) mlPieces.clear();
    a = new Array<SetPiece | undefined>(256);
    for (const pile of chunkPiles(cx, cz).values()) a[(pile.z - cz * 16) * 16 + pile.x - cx * 16] = { kind: 'pile', pile };
    // E23.8.3.2: and the industrial ruins round a steel field
    for (const ruin of chunkRuins(cx, cz).values()) a[(ruin.z - cz * 16) * 16 + ruin.x - cx * 16] ??= { kind: 'ruin', ruin };
    mlPieces.set(k, a);
  }
  return a[(z - cz * 16) * 16 + x - cx * 16];
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

/** Is this Old City chunk the bay (sea inside the island's square)? */
export function isSeaChunk(cx: number, cz: number): boolean {
  return inOldCity(cx, cz) && cz >= OLD_CITY.seaMinZ && cx <= OLD_CITY.seaMaxX;
}

/** E21.26: open sea all round the island: every chunk outside the Old City's square. */
export function isOpenSeaChunk(cx: number, cz: number): boolean {
  return !inOldCity(cx, cz);
}

const LO = OLD_CITY.min * 16;
const HI = (OLD_CITY.max + 1) * 16 - 1;

/** E21.26: the island's coast: the outer tiles of its outer chunks are sea (per edge, data/oldcity COAST). */
export function coastSea(x: number, z: number): boolean {
  return z < LO + COAST.north.band || z > HI - COAST.south.band || x < LO + COAST.west.band || x > HI - COAST.east.band;
}

/** E21.26: the shore just inland of a beach coast (sand). */
export function coastSand(_x: number, z: number): boolean {
  return COAST.south.kind === 'beach' && z > HI - COAST.south.band - 3 && z <= HI - COAST.south.band;
}

/** E21.26: the Landing's jetty (walkable planks over the surf and the bay). */
export function onJetty(x: number, z: number): boolean {
  return inRect(LANDING.jetty, x, z);
}

/** E21.26 / E21.4: is this cell sea (open sea, the bay, the coast band), not counting the jetty? */
export function seaCell(x: number, z: number): boolean {
  if (onJetty(x, z)) return false;
  // E23.8.3.1: the Long Causeway is never sea; the mainland is land past its rocky shore
  if (onCauseway(x, z)) return false;
  if (isMainlandCell(x)) return mainlandShore(x, z);
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  return !inOldCity(cx, cz) || isSeaChunk(cx, cz) || coastSea(x, z);
}

/** Deep water inside a region (a canal), from data/oldcity. */
export function regionWater(x: number, z: number): boolean {
  const r = regionOfCell(x, z);
  return !!r?.water?.some((q) => inWater(q, x, z));
}

/** Is the cell water in this region water rectangle (inside it, and `#` in its outline if it has one)? */
export function inWater(q: WaterRect, x: number, z: number): boolean {
  return inRect(q, x, z) && (!q.mask || q.mask[z - q.z]?.[x - q.x] === '#');
}

/** A water cell of a region water rectangle (its first, row by row). */
export function waterAnchor(q: WaterRect): { x: number; z: number } {
  if (!q.mask) return { x: q.x, z: q.z };
  for (let dz = 0; dz < q.d; dz++) {
    const dx = q.mask[dz]?.indexOf('#') ?? -1;
    if (dx >= 0) return { x: q.x + dx, z: q.z + dz };
  }
  return { x: q.x, z: q.z };
}

/** Deep water inside a region that is a natural pond (the Cistern's), drawn as a pool, not open water. */
export function pondCell(x: number, z: number): boolean {
  const r = regionOfCell(x, z);
  return !!r?.water?.some((q) => q.pond && inWater(q, x, z));
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

/** A smooth 0…1 wobble along the shore (two waves and a little per-column noise), the same every game. */
function shoreWobble(x: number, salt: number): number {
  const s = Math.sin(x * 0.43 + salt) * 0.45 + Math.sin(x * 1.07 + salt * 2.3) * 0.3 + (Math.sin(x * 12.9898 + salt * 78.233) * 43758.5453 % 1) * 0.25;
  return Math.max(0, Math.min(1, 0.5 + s * 0.5));
}

/**
 * E23.13: how many rows of wadable surf a beach column has before the bay (2…5, so the sand meets the water along a
 * ragged line, not a ruler). A column with a salvage pile in its last sand row keeps the pile on dry sand.
 */
export function surfDepth(x: number): number {
  const known = depths.get(x);
  if (known !== undefined) return known;
  let d = Math.round(2 + 3 * shoreWobble(x, 1.7));
  const edge = OLD_CITY.seaMinZ * 16; // the bay's first row
  // a pile, a cache or a gate in the band stays on dry sand, on a little spit of beach: the surf stops short of it
  const dry = (dz: number) => [-1, 0, 1].some((ox) => !!setPieceAt(x + ox, edge - dz)); // with a tile of sand either side
  let ok = 0;
  for (let k = 1; k <= d && !dry(k); k++) ok = k;
  d = ok;
  depths.set(x, d);
  return d;
}
const depths = new Map<number, number>();

/** E23.13: inside a beach's surf band (by its ragged depth), whatever stands there. */
export function inSurfBand(x: number, z: number): boolean {
  const cx = Math.floor(x / 16);
  return isSeaChunk(cx, Math.floor((z + surfDepth(x)) / 16)) && regionOfCell(x, z)?.type === 'beach';
}

/** The beach's shallow surf: the wadable rows just before the bay (it reads as shallow sea, not a dried canal bed). */
export function surfCell(x: number, z: number): boolean {
  return !seaCell(x, z) && inSurfBand(x, z);
}

/**
 * E23.13: the bay's first rows off a beach are a shallow shelf, ragged like the surf (0…2 rows), so the shallows
 * fade into deep water along a wavy line rather than at the bay's straight edge. Drawing only: still open sea.
 */
export function shallowSea(x: number, z: number): boolean {
  const edge = OLD_CITY.seaMinZ * 16;
  if (z < edge || !seaCell(x, z) || regionOfCell(x, edge - 1)?.type !== 'beach') return false;
  return z < edge + Math.round(2 * shoreWobble(x, 4.1));
}
